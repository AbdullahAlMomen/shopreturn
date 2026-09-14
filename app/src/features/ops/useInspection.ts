import { useCallback, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import { insertTimelineEntry, mutationFailed, updateReturnCaseStatus } from "./opsTimeline";

export type ConditionOnArrival = "GOOD" | "MINOR_DAMAGE" | "MAJOR_DAMAGE" | "UNUSABLE";
export type FaultAttribution = "COURIER" | "SELLER" | "CUSTOMER";

export type RecordInspectionInput = {
  returnId: string;
  customerItemId: string;
  conditionOnArrival: ConditionOnArrival;
  restockable: boolean;
  faultAttribution: FaultAttribution;
  // Internal only -- Inspection carries no customer grant at all (see
  // blocks/data/rules.json), so this text is structurally invisible to the
  // customer. It must never be folded into `message` below.
  inspectorNotes: string;
  // The customer-facing sentence ops has written/edited. Deliberately a
  // separate field from inspectorNotes, never derived from it -- the
  // spec's "a rejected customer sees their reason, not the internal debate"
  // applies here too.
  message: string;
};

type GraphQLError = { message?: string };
type InsertInspectionResponse = {
  data?: { insertInspection?: { acknowledged?: boolean; itemId?: string } | null };
  errors?: GraphQLError[];
};

// Three independent, non-transactional writes: insert Inspection, update
// ReturnCase.status, insert ReturnTimeline. Each stage below names the
// write that failed so a retry repeats only what didn't land -- never the
// Inspection row itself once it's in (resubmitting the form would create a
// duplicate; there is no edit/undo path needed here because ops-edits-
// inspections exists, but this hook doesn't use it).
export type InspectionStage = "insert-failed" | "update-failed" | "notify-failed" | undefined;

type PendingCaseUpdate = { itemId: string; customerItemId: string; status: string; message: string };
type PendingNotify = { returnId: string; customerItemId: string; status: string; message: string };

async function insertInspectionRow(input: RecordInspectionInput, inspectedBy: string): Promise<boolean> {
  const response = (await blocksClient.data.collection("Inspection").create({
    returnId: input.returnId,
    // Denormalised owner -- child-row policies (ops-reads-inspections /
    // manager-reads-inspections) don't key on this the way ReturnTimeline's
    // customer-visible policy does, but it's copied for consistency with
    // every other child row in this project and for any future customer-
    // facing use, however unlikely given customers hold no grant here at all.
    customerItemId: input.customerItemId,
    conditionOnArrival: input.conditionOnArrival,
    restockable: input.restockable,
    faultAttribution: input.faultAttribution,
    inspectorNotes: input.inspectorNotes,
    inspectedBy,
    inspectedAt: new Date().toISOString()
  })) as InsertInspectionResponse;
  return !mutationFailed(response, response?.data?.insertInspection);
}

export function useInspection() {
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<InspectionStage>(undefined);
  const [pendingCaseUpdate, setPendingCaseUpdate] = useState<PendingCaseUpdate>();
  const [pendingNotify, setPendingNotify] = useState<PendingNotify>();

  const publishTimeline = useCallback(async (notify: PendingNotify): Promise<boolean> => {
    const notified = await insertTimelineEntry(notify);
    if (!notified) {
      setStage("notify-failed");
      setPendingNotify(notify);
      return false;
    }
    setStage(undefined);
    setPendingNotify(undefined);
    return true;
  }, []);

  const applyCaseUpdate = useCallback(async (update: PendingCaseUpdate): Promise<boolean> => {
    const updated = await updateReturnCaseStatus(update.itemId, { status: update.status });
    if (!updated) {
      setStage("update-failed");
      setPendingCaseUpdate(update);
      return false;
    }
    setPendingCaseUpdate(undefined);
    return publishTimeline({ returnId: update.itemId, customerItemId: update.customerItemId, status: update.status, message: update.message });
  }, [publishTimeline]);

  const recordInspection = useCallback(async (input: RecordInspectionInput): Promise<boolean> => {
    setSubmitting(true);
    setStage(undefined);
    try {
      // Same as useSubmitReturn.ts's ownership lookup: the caller's own
      // identity, resolved live rather than trusted from a stored value.
      const me = (await blocksClient.iam.me()) as {
        data?: { itemId?: string; email?: string; firstName?: string; lastName?: string };
      };
      const profile = me?.data;
      const inspectedBy =
        [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() ||
        profile?.email ||
        profile?.itemId ||
        "ops";

      const inserted = await insertInspectionRow(input, inspectedBy);
      if (!inserted) {
        setStage("insert-failed");
        return false;
      }

      return await applyCaseUpdate({
        itemId: input.returnId,
        customerItemId: input.customerItemId,
        status: "INSPECTED",
        message: input.message
      });
    } catch (caught) {
      setStage("insert-failed");
      void caught;
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [applyCaseUpdate]);

  // Resumes from an update-failed stage: the Inspection row already exists
  // and is never re-inserted. Retries the ReturnCase update, then (if that
  // now succeeds) the timeline insert in the same call.
  const retryUpdate = useCallback(async (): Promise<boolean> => {
    if (!pendingCaseUpdate) return false;
    setSubmitting(true);
    try {
      return await applyCaseUpdate(pendingCaseUpdate);
    } finally {
      setSubmitting(false);
    }
  }, [pendingCaseUpdate, applyCaseUpdate]);

  // Resumes from a notify-failed stage: the ReturnCase update already
  // landed. Retries only the ReturnTimeline insert.
  const retryNotify = useCallback(async (): Promise<boolean> => {
    if (!pendingNotify) return false;
    setSubmitting(true);
    try {
      return await publishTimeline(pendingNotify);
    } finally {
      setSubmitting(false);
    }
  }, [pendingNotify, publishTimeline]);

  return { recordInspection, retryUpdate, retryNotify, submitting, stage, pendingCaseUpdate, pendingNotify };
}

import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import { itemsOrThrow } from "../../lib/blocks/readItems";
import { insertTimelineEntry, updateReturnCaseStatus } from "./opsTimeline";
import { runPatternWatch } from "../insights/runPatternWatch";

// Field names below are copied verbatim from blocks/data/schemas/ReturnCase.json
// -- note the asymmetry the spec itself defines: the reason's confirmed
// column is `confirmedReason` (prefixed), but restockable/courierClaim's
// confirmed columns are bare `restockable`/`courierClaim` (not
// `confirmedRestockable`/`confirmedCourierClaim`). This is not a typo here;
// it must match the schema exactly or the write silently lands on a
// nonexistent field.
export type ReviewReturnCase = {
  ItemId: string;
  customerItemId?: string;
  orderNumber?: string;
  sku?: string;
  productName?: string;
  unitPrice?: number;
  status?: string;
  rawCustomerText?: string;
  aiReason?: string;
  aiConfidence?: number;
  aiRestockable?: boolean;
  aiCourierClaim?: boolean;
  aiDraftMessage?: string;
  confirmedReason?: string;
  restockable?: boolean;
  courierClaim?: boolean;
  opsCorrectedFields?: string[];
  rejectionReason?: string;
  CreatedDate?: string;
};

const RETURN_CASE_FIELDS = [
  "customerItemId", "orderNumber", "sku", "productName", "unitPrice", "status", "rawCustomerText",
  "aiReason", "aiConfidence", "aiRestockable", "aiCourierClaim", "aiDraftMessage",
  "confirmedReason", "restockable", "courierClaim", "opsCorrectedFields", "rejectionReason", "CreatedDate"
];

// Ops sees the whole timeline (internal entries included -- ops-reads-all-
// timeline in rules.json has no isCustomerVisible predicate, unlike the
// customer-facing policy). Read-only here: nothing on this screen ever
// updates or deletes a ReturnTimeline row, per the append-only rule.
export type TimelineEntry = {
  ItemId: string;
  at?: string | null;
  status?: string;
  message?: string;
  isCustomerVisible?: boolean;
  authorRole?: string | null;
  CreatedDate?: string;
};

const TIMELINE_FIELDS = ["at", "status", "message", "isCustomerVisible", "authorRole", "CreatedDate"];

export type RefundRow = {
  ItemId: string;
  method?: string;
  amount?: number;
  reference?: string;
  paidAt?: string;
};

const REFUND_FIELDS = ["method", "amount", "reference", "paidAt"];

export type AcceptInput = {
  confirmedReason: string;
  restockable: boolean;
  courierClaim: boolean;
  opsCorrectedFields: string[];
  message: string;
};

export type RejectInput = {
  rejectionReason: string;
};

// Context needed to retry ONLY the ReturnTimeline insert -- never the
// ReturnCase update, which already succeeded and must not be repeated (and
// there is nothing to repeat: it either landed or it didn't). This is the
// hook's answer to "there is no transaction across the two writes": the
// ReturnCase update and the ReturnTimeline insert are tracked as separate
// outcomes, and a failure of the second never rolls back or re-attempts
// the first. `status` widened from the original ACCEPTED|REJECTED union
// (Task 2) to `string` -- Task 3 reuses this exact mechanism for
// markReceived/startRefund, which land on RECEIVED/REFUND_PROCESSING.
type PendingNotify = {
  returnId: string;
  customerItemId: string;
  status: string;
  message: string;
};

export type SubmitStage = "update-failed" | "notify-failed" | undefined;

// Publishes a customer-visible ReturnTimeline entry after a status write
// that already committed. On failure, the caller is responsible for parking
// `pendingNotify` -- kept here as the one place that performs the insert so
// accept/reject/markReceived/startRefund all fail the same way.
async function publish(setSubmitStage: (stage: SubmitStage) => void, setPendingNotify: (p: PendingNotify | undefined) => void, notify: PendingNotify): Promise<boolean> {
  const notified = await insertTimelineEntry(notify);
  if (!notified) {
    setSubmitStage("notify-failed");
    setPendingNotify(notify);
    return false;
  }
  return true;
}

export function useReviewReturn(itemId?: string) {
  const [returnCase, setReturnCase] = useState<ReviewReturnCase>();
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [refund, setRefund] = useState<RefundRow>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();

  const [submitting, setSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<SubmitStage>(undefined);
  // Set only when the ReturnCase write landed but the ReturnTimeline insert
  // did not -- the exact half-completion the brief says must never be
  // silent. Its presence IS the "customer was not notified" banner.
  const [pendingNotify, setPendingNotify] = useState<PendingNotify>();

  const load = useCallback(async () => {
    if (!itemId) {
      setReturnCase(undefined);
      setTimeline([]);
      setRefund(undefined);
      setLoading(false);
      setLoadError(undefined);
      return;
    }
    setLoading(true);
    setLoadError(undefined);
    try {
      const [caseResponse, timelineResponse, refundResponse] = await Promise.all([
        blocksClient.data
          .collection("ReturnCase", { fields: RETURN_CASE_FIELDS })
          .get(itemId),
        blocksClient.data
          .collection("ReturnTimeline", { fields: TIMELINE_FIELDS })
          .list({ filter: { returnId: itemId }, sort: { at: 1 }, pageNo: 1, pageSize: 100 }),
        blocksClient.data
          .collection("Refund", { fields: REFUND_FIELDS })
          .list({ filter: { returnId: itemId }, pageNo: 1, pageSize: 5 })
      ]);
      // get() returns a list envelope with one item, not a bare object. An
      // empty list here legitimately means "no such return" (bad itemId) --
      // only a failed/renamed read should throw, not a zero-row result.
      setReturnCase(itemsOrThrow<ReviewReturnCase>(caseResponse, "getReturnCases")[0]);
      setTimeline(itemsOrThrow<TimelineEntry>(timelineResponse, "getReturnTimelines"));
      // A return that hasn't been refunded yet simply has no Refund row --
      // an empty list here is expected and must stay empty, not "not found".
      setRefund(itemsOrThrow<RefundRow>(refundResponse, "getRefunds")[0]);
    } catch (caught) {
      setLoadError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => { void load(); }, [load]);

  const accept = useCallback(async (input: AcceptInput): Promise<boolean> => {
    if (!itemId || !returnCase?.customerItemId) return false;
    setSubmitting(true);
    setSubmitStage(undefined);
    try {
      const updated = await updateReturnCaseStatus(itemId, {
        confirmedReason: input.confirmedReason,
        restockable: input.restockable,
        courierClaim: input.courierClaim,
        opsCorrectedFields: input.opsCorrectedFields,
        status: "ACCEPTED"
      });

      if (!updated) {
        setSubmitStage("update-failed");
        return false;
      }

      // The accept has landed, so re-check the return rates (design spec §1).
      // Fire-and-forget by design: detection must never delay, block or undo
      // the case decision ops just made.
      void runPatternWatch().then((summary) => {
        if (summary.error || summary.failed.length > 0) console.warn("[pattern-watch]", summary);
        else if (summary.inserted.length > 0) console.info("[pattern-watch] raised", summary.inserted);
      });

      const notify: PendingNotify = {
        returnId: itemId,
        customerItemId: returnCase.customerItemId,
        status: "ACCEPTED",
        message: input.message
      };
      const ok = await publish(setSubmitStage, setPendingNotify, notify);
      await load();
      return ok;
    } catch (caught) {
      setSubmitStage("update-failed");
      void caught;
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [itemId, returnCase, load]);

  const reject = useCallback(async (input: RejectInput): Promise<boolean> => {
    if (!itemId || !returnCase?.customerItemId) return false;
    setSubmitting(true);
    setSubmitStage(undefined);
    try {
      const updated = await updateReturnCaseStatus(itemId, {
        status: "REJECTED",
        rejectionReason: input.rejectionReason
      });

      if (!updated) {
        setSubmitStage("update-failed");
        return false;
      }

      const notify: PendingNotify = {
        returnId: itemId,
        customerItemId: returnCase.customerItemId,
        status: "REJECTED",
        message: input.rejectionReason
      };
      const ok = await publish(setSubmitStage, setPendingNotify, notify);
      await load();
      return ok;
    } catch (caught) {
      setSubmitStage("update-failed");
      void caught;
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [itemId, returnCase, load]);

  // markReceived (-> RECEIVED) and startRefund (-> REFUND_PROCESSING) are
  // the two guarded transitions that carry no child row of their own --
  // just a status write plus the one customer-visible timeline entry the
  // brief requires per action. Same non-transactional handling as
  // accept/reject: the status write, once it lands, is never retried or
  // rolled back; only the timeline insert is retried on failure.
  const transitionTo = useCallback(async (status: string, message: string): Promise<boolean> => {
    if (!itemId || !returnCase?.customerItemId) return false;
    setSubmitting(true);
    setSubmitStage(undefined);
    try {
      const updated = await updateReturnCaseStatus(itemId, { status });
      if (!updated) {
        setSubmitStage("update-failed");
        return false;
      }
      const notify: PendingNotify = { returnId: itemId, customerItemId: returnCase.customerItemId, status, message };
      const ok = await publish(setSubmitStage, setPendingNotify, notify);
      await load();
      return ok;
    } catch (caught) {
      setSubmitStage("update-failed");
      void caught;
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [itemId, returnCase, load]);

  const markReceived = useCallback((message: string) => transitionTo("RECEIVED", message), [transitionTo]);
  const startRefund = useCallback((message: string) => transitionTo("REFUND_PROCESSING", message), [transitionTo]);

  // Retries ONLY the ReturnTimeline insert -- the ReturnCase write that
  // already succeeded is never repeated or undone.
  const retryNotify = useCallback(async (): Promise<boolean> => {
    if (!pendingNotify) return false;
    setSubmitting(true);
    try {
      const notified = await insertTimelineEntry(pendingNotify);
      if (notified) {
        setSubmitStage(undefined);
        setPendingNotify(undefined);
        await load();
        return true;
      }
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [pendingNotify, load]);

  return {
    returnCase, timeline, refund, loading, loadError, refetch: load,
    accept, reject, markReceived, startRefund, retryNotify,
    submitting, submitStage, pendingNotify
  };
}

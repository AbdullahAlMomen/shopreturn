import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";

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
// the first.
type PendingNotify = {
  returnId: string;
  customerItemId: string;
  status: "ACCEPTED" | "REJECTED";
  message: string;
};

export type SubmitStage = "update-failed" | "notify-failed" | undefined;

type GraphQLError = { message?: string };
type UpdateReturnCaseResponse = {
  data?: { updateReturnCase?: { acknowledged?: boolean; itemId?: string } | null };
  errors?: GraphQLError[];
};
type InsertReturnTimelineResponse = {
  data?: { insertReturnTimeline?: { acknowledged?: boolean; itemId?: string } | null };
  errors?: GraphQLError[];
};

// A 200 can still be a failure: check for a GraphQL `errors` array AND a
// null mutation payload before trusting any write (per task brief and
// useSubmitReturn.ts's isDuplicateOrderError note).
function mutationFailed(response: { errors?: GraphQLError[] } | undefined, payload: { itemId?: string; acknowledged?: boolean } | null | undefined): boolean {
  if (response && Array.isArray(response.errors) && response.errors.length > 0) return true;
  if (!payload?.itemId || payload.acknowledged === false) return true;
  return false;
}

async function insertTimelineEntry(input: PendingNotify): Promise<boolean> {
  const response = (await blocksClient.data.collection("ReturnTimeline").create({
    returnId: input.returnId,
    // Copied from the parent ReturnCase, not the caller's own identity --
    // child-row read policies key on customerItemId, not CreatedBy (unlike
    // ReturnCase itself). Using anything else makes the entry permanently
    // invisible to the customer it's meant for.
    customerItemId: input.customerItemId,
    at: new Date().toISOString(),
    status: input.status,
    isCustomerVisible: true,
    authorRole: "ops",
    message: input.message
  })) as InsertReturnTimelineResponse;
  return !mutationFailed(response, response?.data?.insertReturnTimeline);
}

export function useReviewReturn(itemId?: string) {
  const [returnCase, setReturnCase] = useState<ReviewReturnCase>();
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
      setLoading(false);
      setLoadError(undefined);
      return;
    }
    setLoading(true);
    setLoadError(undefined);
    try {
      const response = (await blocksClient.data
        .collection("ReturnCase", { fields: RETURN_CASE_FIELDS })
        .get(itemId)) as { data?: { getReturnCases?: { items?: ReviewReturnCase[] } } };
      // get() returns a list envelope with one item, not a bare object.
      setReturnCase(response?.data?.getReturnCases?.items?.[0]);
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
      const updateResponse = (await blocksClient.data.collection("ReturnCase").update(itemId, {
        confirmedReason: input.confirmedReason,
        restockable: input.restockable,
        courierClaim: input.courierClaim,
        opsCorrectedFields: input.opsCorrectedFields,
        status: "ACCEPTED"
      })) as UpdateReturnCaseResponse;

      if (mutationFailed(updateResponse, updateResponse?.data?.updateReturnCase)) {
        setSubmitStage("update-failed");
        return false;
      }

      const notify: PendingNotify = {
        returnId: itemId,
        customerItemId: returnCase.customerItemId,
        status: "ACCEPTED",
        message: input.message
      };
      const notified = await insertTimelineEntry(notify);
      if (!notified) {
        // Step 1 (ReturnCase) is already committed. Do NOT retry it, do NOT
        // roll it back -- surface the gap explicitly instead.
        setSubmitStage("notify-failed");
        setPendingNotify(notify);
        await load();
        return false;
      }

      await load();
      return true;
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
      const updateResponse = (await blocksClient.data.collection("ReturnCase").update(itemId, {
        status: "REJECTED",
        rejectionReason: input.rejectionReason
      })) as UpdateReturnCaseResponse;

      if (mutationFailed(updateResponse, updateResponse?.data?.updateReturnCase)) {
        setSubmitStage("update-failed");
        return false;
      }

      const notify: PendingNotify = {
        returnId: itemId,
        customerItemId: returnCase.customerItemId,
        status: "REJECTED",
        message: input.rejectionReason
      };
      const notified = await insertTimelineEntry(notify);
      if (!notified) {
        setSubmitStage("notify-failed");
        setPendingNotify(notify);
        await load();
        return false;
      }

      await load();
      return true;
    } catch (caught) {
      setSubmitStage("update-failed");
      void caught;
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [itemId, returnCase, load]);

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
    returnCase, loading, loadError, refetch: load,
    accept, reject, retryNotify,
    submitting, submitStage, pendingNotify
  };
}

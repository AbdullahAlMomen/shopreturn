import { useCallback, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import { insertTimelineEntry, mutationFailed, updateReturnCaseStatus } from "./opsTimeline";

export type RefundMethod = "BKASH" | "NAGAD" | "BANK";

export type RecordRefundInput = {
  returnId: string;
  customerItemId: string;
  method: RefundMethod;
  amount: number;
  reference: string;
  // The customer-facing sentence ops has written/edited. Callers must
  // include the amount, method and reference in it -- OpsReviewPage builds
  // this deterministically (not free-typed) so the requirement can't be
  // edited away.
  message: string;
};

type GraphQLError = { message?: string };
type InsertRefundResponse = {
  data?: { insertRefund?: { acknowledged?: boolean; itemId?: string } | null };
  errors?: GraphQLError[];
};

// Same three-stage, non-transactional shape as useInspection.ts: insert
// Refund, update ReturnCase.status to REFUNDED, insert ReturnTimeline. A
// retry from any failed stage never repeats a write that already landed.
export type RefundStage = "insert-failed" | "update-failed" | "notify-failed" | undefined;

type PendingCaseUpdate = { itemId: string; customerItemId: string; status: string; message: string };
type PendingNotify = { returnId: string; customerItemId: string; status: string; message: string };

async function insertRefundRow(input: RecordRefundInput): Promise<boolean> {
  const response = (await blocksClient.data.collection("Refund").create({
    returnId: input.returnId,
    // Denormalised owner -- customer-reads-own-refunds keys on this field
    // directly (blocks/data/rules.json), so an omitted or forged value here
    // makes the refund permanently invisible (or misattributed) rather than
    // just late.
    customerItemId: input.customerItemId,
    method: input.method,
    amount: input.amount,
    reference: input.reference,
    paidAt: new Date().toISOString()
  })) as InsertRefundResponse;
  return !mutationFailed(response, response?.data?.insertRefund);
}

export function useRefund() {
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<RefundStage>(undefined);
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

  const recordRefund = useCallback(async (input: RecordRefundInput): Promise<boolean> => {
    setSubmitting(true);
    setStage(undefined);
    try {
      const inserted = await insertRefundRow(input);
      if (!inserted) {
        setStage("insert-failed");
        return false;
      }

      return await applyCaseUpdate({
        itemId: input.returnId,
        customerItemId: input.customerItemId,
        status: "REFUNDED",
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

  const retryUpdate = useCallback(async (): Promise<boolean> => {
    if (!pendingCaseUpdate) return false;
    setSubmitting(true);
    try {
      return await applyCaseUpdate(pendingCaseUpdate);
    } finally {
      setSubmitting(false);
    }
  }, [pendingCaseUpdate, applyCaseUpdate]);

  const retryNotify = useCallback(async (): Promise<boolean> => {
    if (!pendingNotify) return false;
    setSubmitting(true);
    try {
      return await publishTimeline(pendingNotify);
    } finally {
      setSubmitting(false);
    }
  }, [pendingNotify, publishTimeline]);

  return { recordRefund, retryUpdate, retryNotify, submitting, stage, pendingCaseUpdate, pendingNotify };
}

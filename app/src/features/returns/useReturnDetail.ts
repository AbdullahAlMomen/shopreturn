import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";

// Confirmed live (as customer A, against the seeded fixture return) before
// writing this hook -- see task-2-report.md for the raw probe output:
//
//   .list({ filter: { returnId: itemId }, sort: { at: 1 }, pageNo, pageSize })
//
// The OBJECT form works for both `filter` and `sort` and returns rows in
// ascending `at` order. A bare string `sort` ("at") 400s server-side
// ("Unexpected Execution Error" from the gateway) -- only the object form
// is safe. `{ field: 1 }` is ascending; descending/multi-field untested.
// Later tasks (ops console, manager dashboard) should copy the object form,
// not the string form.
export type ReturnCaseDetail = {
  ItemId: string;
  orderNumber?: string;
  sku?: string;
  productName?: string;
  status?: string;
  unitPrice?: number;
  rawCustomerText?: string;
  rejectionReason?: string;
  CreatedDate?: string;
};

export type TimelineEntry = {
  ItemId: string;
  returnId?: string;
  at?: string | null;
  status?: string;
  message?: string;
  isCustomerVisible?: boolean;
  authorRole?: string | null;
  // Platform-managed system field (PascalCase, always present) -- used as
  // the display-timestamp fallback below.
  CreatedDate?: string;
};

export type RefundRow = {
  ItemId: string;
  returnId?: string;
  method?: string;
  amount?: number;
  reference?: string;
  paidAt?: string;
};

// Same field list as Task 1's useMyReturns -- no ai* field, no confirmedReason.
const RETURN_CASE_FIELDS = [
  "orderNumber", "sku", "productName", "status",
  "unitPrice", "rawCustomerText", "rejectionReason", "CreatedDate"
];

// `at` is whatever the writer claimed when the row was appended, and it is
// null on at least one seeded row (an older fixture entry predates the
// field being populated). `CreatedDate` is a server-set system field that
// is always present -- for an append-only trust log that makes it *more*
// trustworthy than `at`, not just a defensive fallback, so it's requested
// alongside the fields the brief specified.
const TIMELINE_FIELDS = ["returnId", "at", "status", "message", "isCustomerVisible", "authorRole", "CreatedDate"];

const REFUND_FIELDS = ["returnId", "method", "amount", "reference", "paidAt"];

// Prefer the server-set CreatedDate over the writer-claimed `at` whenever
// `at` is missing -- see the field-list comment above.
export function timelineTimestamp(entry: TimelineEntry): string | undefined {
  return entry.at ?? entry.CreatedDate;
}

export function useReturnDetail(itemId?: string) {
  const [returnCase, setReturnCase] = useState<ReturnCaseDetail>();
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [refund, setRefund] = useState<RefundRow>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!itemId) {
      setReturnCase(undefined);
      setTimeline([]);
      setRefund(undefined);
      setLoading(false);
      setError(undefined);
      return;
    }

    setLoading(true);
    setError(undefined);
    try {
      const [caseResponse, timelineResponse, refundResponse] = await Promise.all([
        blocksClient.data
          .collection("ReturnCase", { fields: RETURN_CASE_FIELDS })
          .get(itemId) as Promise<{ data?: { getReturnCases?: { items?: ReturnCaseDetail[] } } }>,
        blocksClient.data
          .collection("ReturnTimeline", { fields: TIMELINE_FIELDS })
          .list({ filter: { returnId: itemId }, sort: { at: 1 }, pageNo: 1, pageSize: 100 }) as Promise<{
            data?: { getReturnTimelines?: { items?: TimelineEntry[] } };
          }>,
        blocksClient.data
          .collection("Refund", { fields: REFUND_FIELDS })
          .list({ filter: { returnId: itemId }, pageNo: 1, pageSize: 5 }) as Promise<{
            data?: { getRefunds?: { items?: RefundRow[] } };
          }>
      ]);

      // get() returns a list envelope with one item, not a bare object.
      setReturnCase(caseResponse?.data?.getReturnCases?.items?.[0]);
      setTimeline(timelineResponse?.data?.getReturnTimelines?.items ?? []);
      // A return that hasn't been refunded yet simply has no Refund row.
      setRefund(refundResponse?.data?.getRefunds?.items?.[0]);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => { void load(); }, [load]);

  return { returnCase, timeline, refund, loading, error, refetch: load };
}

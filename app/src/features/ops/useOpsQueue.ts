import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";

// Ops-only view of ReturnCase -- includes the ai* columns, which the
// customer-facing hooks (useMyReturns, useReturnDetail) deliberately never
// request because they're masked from that role anyway. Masking here is
// customer-only: confirmed live (task-1 seed + read-back as ops) that ops
// receives the real aiReason/aiConfidence/aiRestockable/aiCourierClaim/
// aiDraftMessage values, not null.
export type OpsReturnRow = {
  ItemId: string;
  orderNumber?: string;
  productName?: string;
  status?: string;
  rawCustomerText?: string;
  aiReason?: string;
  aiConfidence?: number;
  confirmedReason?: string;
  // Platform-managed system field (PascalCase) -- see useMyReturns.ts for
  // the same confirmed-live note. Used for both the age column and sort.
  CreatedDate?: string;
};

const FIELDS = [
  "orderNumber", "productName", "status", "rawCustomerText",
  "aiReason", "aiConfidence", "confirmedReason", "CreatedDate"
];

// Deliberately no ownership filter -- ops legitimately sees every return,
// and the server (staff-reads-all-returns, or equivalent) already decided
// that. Adding a client-side filter here would protect nothing and would
// obscure where the real boundary lives.
//
// Sort: `{ CreatedDate: -1 }` (object form; a bare string sort 400s -- see
// useReturnDetail.ts) is confirmed live to return newest-first. `0` 400s
// ("Unexpected Execution Error"); `1` is ascending. -1 is what this hook
// uses. See task-1-report.md for the raw probe output.
export type QueueScope = "open" | "all";

// Terminal statuses leave the default queue: a refunded or rejected case is
// history, not work. Filtered server-side (Mongo-style $nin, confirmed live)
// rather than client-side, because the queue fetches one page -- filtering
// that page in the browser would still let open cases fall off its end.
// $nin also matches rows with no status at all, which is what we want: a
// case in an unexpected state should surface, not vanish.
const TERMINAL_STATUSES = ["REFUNDED", "REJECTED"];

export function useOpsQueue(scope: QueueScope) {
  const [returns, setReturns] = useState<OpsReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await blocksClient.data
        .collection("ReturnCase", { fields: FIELDS })
        .list({
          pageNo: 1,
          pageSize: 50,
          sort: { CreatedDate: -1 },
          ...(scope === "open" ? { filter: { status: { $nin: TERMINAL_STATUSES } } } : {})
        }) as {
          data?: { getReturnCases?: { items?: OpsReturnRow[] } };
        };
      setReturns(response?.data?.getReturnCases?.items ?? []);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { void load(); }, [load]);

  return { returns, loading, error, refetch: load };
}

import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import { itemsOrThrow } from "../../lib/blocks/readItems";
import { computeInsights } from "./analytics";
import type { CaseRow, Insights, OrderRow } from "./analytics";

const ORDER_FIELDS = ["orderNumber", "sku", "productName", "unitPrice", "area", "courier"];
const CASE_FIELDS = [...ORDER_FIELDS, "status", "confirmedReason", "aiReason"];
const PAGE_SIZE = 100;

// No aggregate query exists in the Data Gateway, so the dataset is paged in
// and reduced in the browser. MAX_PAGES is a data limit, not a runaway
// guard: if the collection is bigger than this, the loop throws rather than
// silently reducing over a partial set (see the check after the loop below).
const MAX_PAGES = 50;

async function listAll<T>(schema: string, fields: string[]): Promise<T[]> {
  const listField = `get${schema}s`;
  const rows: T[] = [];
  let lastPageWasFull = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    // Oldest first: new inserts land at the end of the collection, so
    // skip/limit paging stays stable across pages even if rows are being
    // added while this loop runs.
    const response = await blocksClient.data
      .collection(schema, { fields })
      .list({ pageNo: page, pageSize: PAGE_SIZE, sort: { CreatedDate: 1 } });
    const items = itemsOrThrow<T>(response, listField);
    rows.push(...items);
    lastPageWasFull = items.length === PAGE_SIZE;
    if (!lastPageWasFull) break;
  }
  if (lastPageWasFull) {
    throw new Error(
      `${schema} exceeds ${MAX_PAGES * PAGE_SIZE} rows; the dashboard refuses to show partial ` +
      "totals, because counting only some orders would inflate every return rate"
    );
  }
  return rows;
}

export function useInsights() {
  const [insights, setInsights] = useState<Insights>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      // No ownership filter: the manager legitimately sees every order and
      // case, and the read policies already decided that server-side.
      const [orders, cases] = await Promise.all([
        listAll<OrderRow>("Order", ORDER_FIELDS),
        listAll<CaseRow>("ReturnCase", CASE_FIELDS)
      ]);
      setInsights(computeInsights(orders, cases));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { insights, loading, error, refetch: load };
}

import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import { computeInsights } from "./analytics";
import type { CaseRow, Insights, OrderRow } from "./analytics";

const ORDER_FIELDS = ["orderNumber", "sku", "productName", "unitPrice", "area", "courier"];
const CASE_FIELDS = [...ORDER_FIELDS, "status", "confirmedReason", "aiReason"];

// No aggregate query exists in the Data Gateway, so the dataset is paged in
// and reduced in the browser. The 50-page cap is a runaway guard, not a data
// limit (5,000 rows each at pageSize 100).
async function listAll<T>(schema: string, fields: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const response = await blocksClient.data
      .collection(schema, { fields })
      .list({ pageNo: page, pageSize: 100 }) as { data?: Record<string, { items?: T[] } | undefined> };
    const items = response?.data?.[`get${schema}s`]?.items ?? [];
    rows.push(...items);
    if (items.length < 100) break;
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

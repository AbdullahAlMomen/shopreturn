import { useCallback, useEffect, useState } from "react";
import { computeInsights } from "./analytics";
import type { Insights } from "./analytics";
import { loadInsightsData } from "./loadInsightsData";

export function useInsights() {
  const [insights, setInsights] = useState<Insights>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const { orders, cases } = await loadInsightsData();
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

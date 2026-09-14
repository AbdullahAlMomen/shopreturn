import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import { itemsOrThrow } from "../../lib/blocks/readItems";
import { useMe } from "../../lib/blocks/useMe";
import { mutationFailed } from "../ops/opsTimeline";
import type { GraphQLError, MutationPayload } from "../ops/opsTimeline";

export type AlertRow = {
  ItemId: string;
  dimension?: string;
  value?: string;
  metric?: number;
  threshold?: number;
  takaImpact?: number;
  draftExplanation?: string;
  raisedAt?: string;
  acknowledgedBy?: string;
};

// Confirmed live field names; any other name returns 400.
const FIELDS = ["dimension", "value", "metric", "threshold", "takaImpact", "draftExplanation", "raisedAt", "acknowledgedBy"];

type UpdateResponse = { data?: { updatePatternAlert?: MutationPayload }; errors?: GraphQLError[] };

export function useAlerts() {
  const me = useMe();
  const managerEmail = me.data?.data?.email ?? "";
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await blocksClient.data
        .collection("PatternAlert", { fields: FIELDS })
        .list({ pageNo: 1, pageSize: 20, sort: { CreatedDate: -1 } });
      setAlerts(itemsOrThrow<AlertRow>(response, "getPatternAlerts"));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // "Acknowledged" is recorded as who acknowledged it. An empty string means
  // nobody has -- the fixture is reset to "", not null.
  const acknowledge = useCallback(async (itemId: string): Promise<boolean> => {
    if (!managerEmail) return false;
    try {
      const response = await blocksClient.data
        .collection("PatternAlert")
        .update(itemId, { acknowledgedBy: managerEmail }) as UpdateResponse;
      if (mutationFailed(response, response?.data?.updatePatternAlert)) return false;
      await load();
      return true;
    } catch {
      return false;
    }
  }, [load, managerEmail]);

  return { alerts, loading, error, acknowledge, refetch: load };
}

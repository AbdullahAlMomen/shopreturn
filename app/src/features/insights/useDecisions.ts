import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import { itemsOrThrow } from "../../lib/blocks/readItems";
import { useMe } from "../../lib/blocks/useMe";
import { mutationFailed } from "../ops/opsTimeline";
import type { GraphQLError, MutationPayload } from "../ops/opsTimeline";

export type DecisionType = "SIZE_CHART_FIX" | "COURIER_CLAIM" | "COD_PAUSE" | "OTHER";

export type DecisionRow = {
  ItemId: string;
  alertId?: string;
  decisionType?: string;
  target?: string;
  note?: string;
  decidedBy?: string;
  decidedAt?: string;
  status?: string;
};

const FIELDS = ["alertId", "decisionType", "target", "note", "decidedBy", "decidedAt", "status"];

type InsertResponse = { data?: { insertDecision?: MutationPayload }; errors?: GraphQLError[] };
type UpdateResponse = { data?: { updateDecision?: MutationPayload }; errors?: GraphQLError[] };

// The log is append-and-amend: the manager has no delete grant on Decision
// (401, confirmed live), so no delete control is ever offered. A decision
// that turns out wrong is marked done and superseded by a new one.
export function useDecisions() {
  const me = useMe();
  const managerEmail = me.data?.data?.email ?? "";
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await blocksClient.data
        .collection("Decision", { fields: FIELDS })
        .list({ pageNo: 1, pageSize: 50, sort: { CreatedDate: -1 } });
      setDecisions(itemsOrThrow<DecisionRow>(response, "getDecisions"));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // A decider-less decision row is debris the manager cannot delete (no
  // delete grant on Decision, see the comment above), so refuse to write
  // one rather than record a decision nobody is accountable for.
  const record = useCallback(async (input: { alertId: string; decisionType: DecisionType; target: string; note: string }): Promise<boolean> => {
    if (!managerEmail) return false;
    try {
      const response = await blocksClient.data.collection("Decision").create({
        ...input,
        decidedBy: managerEmail,
        decidedAt: new Date().toISOString(),
        status: "OPEN"
      }) as InsertResponse;
      if (mutationFailed(response, response?.data?.insertDecision)) return false;
      await load();
      return true;
    } catch {
      return false;
    }
  }, [load, managerEmail]);

  const complete = useCallback(async (itemId: string): Promise<boolean> => {
    try {
      const response = await blocksClient.data.collection("Decision").update(itemId, { status: "DONE" }) as UpdateResponse;
      if (mutationFailed(response, response?.data?.updateDecision)) return false;
      await load();
      return true;
    } catch {
      return false;
    }
  }, [load]);

  return { decisions, loading, error, record, complete, refetch: load };
}

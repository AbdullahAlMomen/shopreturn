import { blocksClient } from "../../lib/blocks/client";
import { notifyRole } from "../../lib/blocks/notify";
import { computeInsights } from "./analytics";
import { loadInsightsData } from "./loadInsightsData";
import { buildAlert, classifyAlertInsert, findBreaches } from "./patternWatch";
import type { InsertOutcome } from "./patternWatch";

export type PatternWatchResult = {
  inserted: string[];
  duplicate: string[];
  failed: string[];
  error?: string;
};

// Runs in the ops browser. Ops can create PatternAlert rows but cannot read
// them, so duplicates are prevented by alertKey uniqueness, not by a read.
// Never throws: callers fire it after an accept has already landed.
export async function runPatternWatch(now: Date = new Date()): Promise<PatternWatchResult> {
  const result: PatternWatchResult = { inserted: [], duplicate: [], failed: [] };
  try {
    const { orders, cases } = await loadInsightsData();
    for (const breach of findBreaches(computeInsights(orders, cases))) {
      const alert = buildAlert(breach, cases, now);
      let outcome: InsertOutcome;
      try {
        outcome = classifyAlertInsert(await blocksClient.data.collection("PatternAlert").create(alert));
      } catch {
        outcome = "failed";
      }
      result[outcome === "inserted" ? "inserted" : outcome === "duplicate" ? "duplicate" : "failed"].push(alert.alertKey);
      // Only a genuinely new alert pings the manager; a uniqueness rejection
      // sends nothing, so one breach never notifies twice in a week.
      if (outcome === "inserted") {
        await notifyRole("manager", "PATTERN_ALERT", {
          alertKey: alert.alertKey,
          dimension: alert.dimension,
          value: alert.value,
          metric: alert.metric
        });
      }
    }
  } catch (caught) {
    result.error = (caught as Error).message;
  }
  return result;
}

// Pattern Watch: pure detection over the dashboard's own aggregates. No I/O
// here -- runPatternWatch.ts does the fetching, inserting and notifying.
import { formatPercent, formatTaka, reasonOf } from "./analytics";
import type { CaseRow, Facet, Insights } from "./analytics";
import { ALERT_THRESHOLD_PERCENT, BREACH_RATE, MIN_ORDERS } from "./thresholds";

export type Dimension = "SKU" | "AREA" | "COURIER";

export type Breach = { dimension: Dimension; facet: Facet };

export type PatternAlertInput = {
  alertKey: string;
  dimension: Dimension;
  value: string;
  metric: number;
  threshold: number;
  takaImpact: number;
  contributingReturnIds: string[];
  draftExplanation: string;
  raisedAt: string;
  acknowledgedBy: string;
};

export type InsertOutcome = "inserted" | "duplicate" | "failed";

// ISO-8601 week-numbering year and week, from the UTC calendar date. The
// week containing a year's first Thursday is week 1, so late-December and
// early-January dates can belong to the neighbouring week-year.
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const weekYear = d.getUTCFullYear();
  const yearStart = Date.UTC(weekYear, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

// The week in the key allows at most one alert per facet per week: the
// database rejects a second insert, so ops never needs to read an alert.
export function buildAlertKey(dimension: Dimension, facetKey: string, date: Date): string {
  return `${dimension}:${facetKey}:${isoWeek(date)}`;
}

export function findBreaches(insights: Insights): Breach[] {
  const groups: [Dimension, Facet[]][] = [
    ["SKU", insights.byProduct],
    ["AREA", insights.byArea],
    ["COURIER", insights.byCourier]
  ];
  return groups.flatMap(([dimension, facets]) =>
    facets
      // UNSPECIFIED is "not recorded" -- not a product or place anyone can act on.
      .filter((f) => f.key !== "UNSPECIFIED" && f.orders >= MIN_ORDERS && f.rate >= BREACH_RATE)
      .map((f) => ({ dimension, facet: f }))
  );
}

function ownCases(dimension: Dimension, key: string, cases: CaseRow[]): CaseRow[] {
  return cases.filter((row) =>
    dimension === "SKU" ? row.sku === key : dimension === "AREA" ? row.area === key : row.courier === key
  );
}

function topOf(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

const REASON_WORDS: Record<string, string> = {
  DAMAGED_IN_TRANSIT: "damaged in transit",
  WRONG_SIZE: "wrong size",
  DEFECTIVE: "defective",
  LATE_DELIVERY: "late delivery",
  COD_REFUSAL: "COD refusal",
  CHANGED_MIND: "changed mind",
  OTHER: "other reasons",
  UNCATEGORISED: "uncategorised"
};

function productText(sku: string | undefined, cases: CaseRow[]): string | undefined {
  if (!sku) return undefined;
  const name = cases.find((row) => row.sku === sku)?.productName;
  return name ? `${name} (${sku})` : sku;
}

function mostClause(verb: string, descriptors: (string | undefined)[], reason: string): string {
  const parts = descriptors.filter((part): part is string => Boolean(part));
  return parts.length > 0
    ? `Most ${verb} ${parts.join(" ")}, most often ${reason}.`
    : `Most often ${reason}.`;
}

// Built from the breaching facet's OWN returns, never the global rankings,
// which would pin another facet's problem on this one. Stored in English:
// it is data recorded at detection, not UI chrome.
export function draftExplanation(dimension: Dimension, facet: Facet, cases: CaseRow[]): string {
  const own = ownCases(dimension, facet.key, cases);
  const rate = formatPercent(facet.rate);
  const taka = formatTaka(facet.takaImpact);
  const reasonCode = topOf(own.map(reasonOf)) ?? "UNCATEGORISED";
  const reason = REASON_WORDS[reasonCode] ?? reasonCode.toLowerCase().split("_").join(" ");
  const area = topOf(own.map((row) => row.area));
  const courier = topOf(own.map((row) => row.courier));
  const product = productText(topOf(own.map((row) => row.sku)), own);

  if (dimension === "SKU") {
    const name = facet.label && facet.label !== facet.key ? `${facet.label} (${facet.key})` : facet.key;
    return `${facet.returns} of ${facet.orders} ${name} orders were returned (${rate}), ${taka}. ` +
      mostClause("came", [area && `from ${area}`, courier && `via ${courier}`], reason);
  }
  if (dimension === "AREA") {
    return `${facet.returns} of ${facet.orders} orders in ${facet.key} were returned (${rate}), ${taka}. ` +
      mostClause("were", [product, courier && `via ${courier}`], reason);
  }
  return `${facet.returns} of ${facet.orders} ${facet.key} orders were returned (${rate}), ${taka}. ` +
    mostClause("were", [product, area && `in ${area}`], reason);
}

export function buildAlert(breach: Breach, cases: CaseRow[], now: Date): PatternAlertInput {
  const { dimension, facet } = breach;
  return {
    alertKey: buildAlertKey(dimension, facet.key, now),
    dimension,
    value: facet.key,
    metric: Math.round(facet.rate * 1000) / 10,
    threshold: ALERT_THRESHOLD_PERCENT,
    takaImpact: facet.takaImpact,
    contributingReturnIds: ownCases(dimension, facet.key, cases)
      .map((row) => row.ItemId)
      .filter((id): id is string => Boolean(id)),
    draftExplanation: draftExplanation(dimension, facet, cases),
    raisedAt: now.toISOString(),
    acknowledgedBy: ""
  };
}

// A uniqueness rejection on alertKey means "already raised this week" and is
// the expected second-accept outcome, not a failure. The platform reports it
// as a 200 with a GraphQL errors array and a null payload. The alertKey and
// already-exists markers must both come from the SAME error message: with
// several errors present, matching each marker against the array as a whole
// (e.g. via a combined JSON.stringify) can pair unrelated errors together --
// a uniqueness failure on some other field plus an unrelated mention of
// alertKey -- and misclassify a real failure as a harmless duplicate.
export function classifyAlertInsert(response: unknown): InsertOutcome {
  const r = (response ?? {}) as {
    errors?: unknown;
    data?: { insertPatternAlert?: { itemId?: string; acknowledged?: boolean } | null };
  };
  const errors = Array.isArray(r.errors) ? r.errors : [];
  if (errors.length > 0) {
    const isAlertKeyDuplicate = errors.some((error) => {
      if (typeof error !== "object" || error === null) return false;
      const message = (error as { message?: unknown }).message;
      return typeof message === "string" && message.includes("alertKey") && message.toLowerCase().includes("already exists");
    });
    return isAlertKeyDuplicate ? "duplicate" : "failed";
  }
  const payload = r.data?.insertPatternAlert;
  return payload?.itemId && payload.acknowledged !== false ? "inserted" : "failed";
}

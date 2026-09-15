# ShopReturn Notifications and Pattern Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise a pattern alert with a drafted explanation the moment a return confirmation pushes a SKU, area or courier past the threshold, notify the manager, and notify ops when a customer submits a return.

**Architecture:** Detection is a pure, unit-tested module over the dashboard's own `computeInsights`, run in the ops browser right after an accept lands. Duplicates are prevented by a unique `alertKey` carrying the ISO week, so ops (who cannot read alerts) never needs to read one. Notifications go through one helper that fills the five fields the notifier requires, and the bell reads the persisted inbox at page 0.

**Tech Stack:** Vite 8.3 + React 18 + TypeScript, `@seliseblocks/client` 0.2.0, vitest 5, the `blocks` CLI 0.5.0, the headless harness in `tools/access-check/`.

**Spec:** `docs/superpowers/specs/2026-09-15-shopreturn-notifications-pattern-watch-design.md`

## Global Constraints

- **The server is the only boundary.** UI gating is UX. Never filter for privacy in the UI.
- **Never trust a 200.** A response can carry a GraphQL `errors` array, an `errors` object with keys, `isSuccess: false`, or a null / unacknowledged mutation payload. Check all of them.
- **`401` is a denial; `400` is a malformed call.** Never record a `400` as an access result.
- **Row updates are positional:** `.update(itemId, fields)`.
- **Paging bases differ.** Data Gateway `list({ pageNo })` is **1-indexed**. Notifier `getNotifications({ page })` and `blocks notification list --page` are **0-indexed** — `page: 1` of a one-page inbox returns an empty list while the count is non-zero.
- **Notify request, verbatim:** `configurationName: "shopreturn"`, `connectionId: ""`, `responseKey: "shopreturn"`, `responseValue: <kind>`, `roles: [<role>]`, `denormalizedPayload: JSON.stringify({ kind, ...payload })`, `saveDenormalizedPayloadAsAnObject: true`.
- **Thresholds:** `BREACH_RATE = 0.30`, `MIN_ORDERS = 20`, stored `threshold` field `30`.
- **`alertKey` format:** `${DIMENSION}:${facetKey}:${isoWeek}`, dimension one of `SKU`, `AREA`, `COURIER`; `isoWeek` is the ISO-8601 week-numbering year and week `YYYY-Www`, computed from the **UTC** calendar date.
- **No role can delete a `PatternAlert`.** Never create a probe alert row that could persist. Prove ops' insert right only through a uniqueness rejection (creates nothing) or real detection.
- **Fixture ids:** pattern alert `ee6d9ac1-9451-4f2b-b9ea-e762fa7b3eaf`; notification configuration `aadbf206-1421-4998-90ef-c6122e890260`; release repo `6ea7f662-94cf-47e0-85e5-0df21be24aab`; `PatternAlert` schema `84171f54-5a49-4b4e-833e-0ad8e90e41b8`.
- **i18n keys must exist in all three files** (`app/src/lib/i18n/dictionary.ts`, `app/blocks/localization/common.en.json`, `app/blocks/localization/common.bn.json`); `node scripts/i18n-parity.mjs` exits 0. `t()` has no interpolation — fill `{name}` with `.replace`. Never run `blocks localization pull`.
- **Secrets** live only in `tools/access-check/.env`. Never print tokens or passwords.
- **Every cloud mutation:** `--dry-run`, show the user, get approval, then `--yes`. Approved mutations are run by the controller (subagent `--yes` on `blocks` mutations has been blocked by the permission classifier).
- `npm run lint`, `npm run build`, `npm test` clean from `app/`. No `any`. `app/tsconfig.json` has `noUncheckedIndexedAccess: true`.
- A Vite dev server runs on port 5173 for the user — never start, stop or restart it. Never run `npm ci` in `app/` while it runs (it deletes files the server holds open).
- Work on branch `dev`. Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Deviations from the spec, decided while planning

1. **`contributingReturnIds` is written as a `string[]`**, not a JSON string. The schema declares it `isArray: true`, and it already reads back as an array.
2. **Schema, backfill and policy order.** `blocks data sync` pushes the schema and deploys the insert policy in one step, then the fixture is backfilled. This is safe because no detection code runs anywhere until Task 5 ships, so nothing can insert an alert between the policy going live and the backfill.
3. **"A second accept in the same week raises nothing"** is proven by Task 4's uniqueness probe (an ops insert with an existing key is rejected and creates nothing) plus unit tests of the classifier, not by a second live accept — customer A has only one eligible order left, and a return on customer B's `10-5001` would make the SH-022 fixture alert stale.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/src/lib/blocks/listAll.ts` | **Create.** Paged, fail-loudly collection read (moved out of `useInsights.ts`). |
| `app/src/features/insights/loadInsightsData.ts` | **Create.** The one definition of which `Order`/`ReturnCase` fields insights and detection read. |
| `app/src/features/insights/thresholds.ts` | **Create.** `BREACH_RATE`, `MIN_ORDERS`, `ALERT_THRESHOLD_PERCENT`. |
| `app/src/features/insights/analytics.ts` | **Modify.** Export `reasonOf`; add `ItemId` to `CaseRow`. |
| `app/src/features/insights/useInsights.ts` | **Modify.** Use `loadInsightsData`. |
| `app/src/features/insights/FacetBars.tsx` | **Modify.** Import `BREACH_RATE`. |
| `app/src/features/insights/patternWatch.ts` | **Create.** Pure detection: breaches, ISO week, key, explanation, alert build, insert classification. |
| `app/src/features/insights/patternWatch.test.ts` | **Create.** |
| `app/src/features/insights/runPatternWatch.ts` | **Create.** Fetch, detect, insert, notify. Never throws. |
| `app/src/features/ops/useReviewReturn.ts` | **Modify.** Fire detection after a successful accept. |
| `app/src/lib/blocks/notify.ts` | **Create.** `notifyRole` and its pure request/failure helpers. |
| `app/src/lib/blocks/notify.test.ts` | **Create.** |
| `app/src/app/layout/describeNotification.ts` | **Create.** Pure inbox item → translated sentence + link. |
| `app/src/app/layout/describeNotification.test.ts` | **Create.** |
| `app/src/app/layout/useNotifications.ts` | **Create.** Inbox state, polling, mark read. |
| `app/src/app/layout/NotificationsMenu.tsx` | **Replace.** Live inbox bell. |
| `app/src/app/layout/AppShell.tsx` | **Modify.** Pass `onNavigate` to the bell. |
| `app/src/features/returns/useSubmitReturn.ts` | **Modify.** Notify ops after a successful insert. |
| `app/src/app/styles.css` | **Modify.** Bell styles. |
| i18n files (three) | **Modify.** Notification keys; reword `insights.alerts.draftLabel`. |
| `blocks/data/schemas/PatternAlert.json` | **Modify.** Add unique `alertKey`. |
| `blocks/data/rules.json` | **Modify.** Add `ops-inserts-pattern-alerts`. |
| `tools/access-check/backfill-pattern-alert-key.mjs` | **Create.** One-off migration of the fixture alert's key. |
| `tools/access-check/probe-alert-key-uniqueness.mjs` | **Create.** Proves ops insert + uniqueness without creating a row. |
| `tools/access-check/verify-pattern-watch.mjs` | **Create.** Read-only end-to-end verifier. |
| `tools/access-check/assertions.mjs` | **Modify.** Assertions #15 and #16. |

---

### Task 1: Shared data loading and thresholds (no behaviour change)

**Files:**
- Create: `app/src/lib/blocks/listAll.ts`, `app/src/features/insights/loadInsightsData.ts`, `app/src/features/insights/thresholds.ts`
- Modify: `app/src/features/insights/useInsights.ts`, `app/src/features/insights/analytics.ts`, `app/src/features/insights/FacetBars.tsx`

**Interfaces:**
- Produces: `listAll<T>(schema: string, fields: string[]): Promise<T[]>`; `ORDER_FIELDS: string[]`; `CASE_FIELDS: string[]`; `loadInsightsData(): Promise<{ orders: OrderRow[]; cases: CaseRow[] }>`; `BREACH_RATE = 0.3`; `MIN_ORDERS = 20`; `ALERT_THRESHOLD_PERCENT = 30`; `reasonOf(row: CaseRow): string` (now exported); `CaseRow` gains `ItemId?: string`.

- [ ] **Step 1: Record the baseline**

Run: `cd app && npm test && npm run lint && npm run build`
Expected: 47 tests pass; lint and build clean. Record the count.

- [ ] **Step 2: Create `app/src/lib/blocks/listAll.ts`**

```typescript
import { blocksClient } from "./client";
import { itemsOrThrow } from "./readItems";

const PAGE_SIZE = 100;

// MAX_PAGES is a data limit, not a runaway guard: a collection bigger than
// this throws rather than letting a caller reduce over a partial set.
// Counting only some orders would inflate every return rate built on them.
const MAX_PAGES = 50;

export async function listAll<T>(schema: string, fields: string[]): Promise<T[]> {
  const listField = `get${schema}s`;
  const rows: T[] = [];
  let lastPageWasFull = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    // Oldest first: new inserts land at the end, so skip/limit paging stays
    // stable even if rows are added while this loop runs.
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
      `${schema} exceeds ${MAX_PAGES * PAGE_SIZE} rows; refusing to reduce over a partial set, ` +
      "because counting only some rows would misstate every rate built on them"
    );
  }
  return rows;
}
```

- [ ] **Step 3: Create `app/src/features/insights/loadInsightsData.ts`**

```typescript
import { listAll } from "../../lib/blocks/listAll";
import type { CaseRow, OrderRow } from "./analytics";

// The single definition of what the dashboard and Pattern Watch read, so an
// alert and the Analytics page can never be computed from different fields.
export const ORDER_FIELDS = ["orderNumber", "sku", "productName", "unitPrice", "area", "courier"];
export const CASE_FIELDS = [...ORDER_FIELDS, "status", "confirmedReason", "aiReason"];

export async function loadInsightsData(): Promise<{ orders: OrderRow[]; cases: CaseRow[] }> {
  // No ownership filter: manager and ops legitimately read every order and
  // case, and the read policies decided that server-side.
  const [orders, cases] = await Promise.all([
    listAll<OrderRow>("Order", ORDER_FIELDS),
    listAll<CaseRow>("ReturnCase", CASE_FIELDS)
  ]);
  return { orders, cases };
}
```

- [ ] **Step 4: Create `app/src/features/insights/thresholds.ts`**

```typescript
// One source for the breach rule. FacetBars' breach styling and Pattern
// Watch's alert rule import these, so they cannot drift apart.
export const BREACH_RATE = 0.3;
export const MIN_ORDERS = 20;
export const ALERT_THRESHOLD_PERCENT = 30;
```

- [ ] **Step 5: Rewrite `app/src/features/insights/useInsights.ts`**

```typescript
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
```

- [ ] **Step 6: Edit `app/src/features/insights/analytics.ts`**

Change `export type CaseRow = OrderRow & {` to include `ItemId?: string;` as its first member, and change `function reasonOf(row: CaseRow): string {` to `export function reasonOf(row: CaseRow): string {`. Change nothing else.

- [ ] **Step 7: Edit `app/src/features/insights/FacetBars.tsx`**

Delete the local `const BREACH_RATE = 0.3;` line (and its comment) and add `import { BREACH_RATE } from "./thresholds";` with the other imports.

- [ ] **Step 8: Verify nothing changed behaviourally**

Run: `cd app && npm test && npm run lint && npm run build`
Expected: the same test count as Step 1, all passing; lint and build clean. Then `grep -rn "BREACH_RATE = \|function listAll" src/` must show exactly one `BREACH_RATE =` (in `thresholds.ts`) and one `function listAll` (in `lib/blocks/listAll.ts`).

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/blocks/listAll.ts app/src/features/insights/loadInsightsData.ts app/src/features/insights/thresholds.ts app/src/features/insights/useInsights.ts app/src/features/insights/analytics.ts app/src/features/insights/FacetBars.tsx
git commit -m "refactor(insights): share data loading and breach thresholds"
```

---

### Task 2: Pattern Watch pure core (TDD)

**Files:**
- Create: `app/src/features/insights/patternWatch.ts`, `app/src/features/insights/patternWatch.test.ts`

**Interfaces:**
- Consumes: `Facet`, `Insights`, `CaseRow`, `reasonOf`, `formatPercent`, `formatTaka` from `./analytics`; `BREACH_RATE`, `MIN_ORDERS`, `ALERT_THRESHOLD_PERCENT` from `./thresholds`.
- Produces:
  - `type Dimension = "SKU" | "AREA" | "COURIER"`
  - `type Breach = { dimension: Dimension; facet: Facet }`
  - `type PatternAlertInput = { alertKey: string; dimension: Dimension; value: string; metric: number; threshold: number; takaImpact: number; contributingReturnIds: string[]; draftExplanation: string; raisedAt: string; acknowledgedBy: string }`
  - `type InsertOutcome = "inserted" | "duplicate" | "failed"`
  - `isoWeek(date: Date): string`
  - `buildAlertKey(dimension: Dimension, facetKey: string, date: Date): string`
  - `findBreaches(insights: Insights): Breach[]`
  - `draftExplanation(dimension: Dimension, facet: Facet, cases: CaseRow[]): string`
  - `buildAlert(breach: Breach, cases: CaseRow[], now: Date): PatternAlertInput`
  - `classifyAlertInsert(response: unknown): InsertOutcome`

- [ ] **Step 1: Write the failing tests** — `app/src/features/insights/patternWatch.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import type { CaseRow, Facet, Insights } from "./analytics";
import {
  buildAlert,
  buildAlertKey,
  classifyAlertInsert,
  draftExplanation,
  findBreaches,
  isoWeek
} from "./patternWatch";

function facet(key: string, orders: number, returns: number, takaImpact = 0, label = key): Facet {
  return { key, label, orders, returns, rate: orders > 0 ? returns / orders : 0, takaImpact };
}

function insightsWith(parts: Partial<Pick<Insights, "byProduct" | "byArea" | "byCourier">>): Insights {
  return {
    totals: { orders: 0, returns: 0, rate: 0, takaImpact: 0 },
    byProduct: parts.byProduct ?? [],
    byArea: parts.byArea ?? [],
    byCourier: parts.byCourier ?? [],
    byReason: []
  };
}

function rows(count: number, row: CaseRow, idPrefix: string): CaseRow[] {
  return Array.from({ length: count }, (_, i) => ({ ...row, ItemId: `${idPrefix}-${i}` }));
}

const sneakerCases: CaseRow[] = [
  ...rows(24, { sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier", confirmedReason: "DAMAGED_IN_TRANSIT" }, "hot"),
  ...rows(7, { sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Gulshan 2", courier: "RedX", confirmedReason: "WRONG_SIZE" }, "cold")
];

const mirpurCases: CaseRow[] = [
  ...rows(24, { sku: "SH-022", productName: "Canvas Sneaker", unitPrice: 1450, area: "Mirpur 11", courier: "Sundarban Courier", confirmedReason: "DAMAGED_IN_TRANSIT" }, "m"),
  ...rows(2, { sku: "TS-104", productName: "Cotton T-Shirt", unitPrice: 890, area: "Mirpur 11", courier: "Sundarban Courier", confirmedReason: "DEFECTIVE" }, "t")
];

describe("findBreaches", () => {
  it("flags a facet at exactly the threshold with enough orders", () => {
    expect(findBreaches(insightsWith({ byProduct: [facet("A", 20, 6)] }))).toHaveLength(1);
  });

  it("ignores a facet just below the threshold", () => {
    expect(findBreaches(insightsWith({ byProduct: [facet("A", 100, 29)] }))).toHaveLength(0);
  });

  it("ignores a facet with fewer than the minimum orders, however high its rate", () => {
    expect(findBreaches(insightsWith({ byProduct: [facet("A", 19, 19)] }))).toHaveLength(0);
  });

  it("never alerts on the UNSPECIFIED bucket", () => {
    expect(findBreaches(insightsWith({ byArea: [facet("UNSPECIFIED", 50, 40)] }))).toHaveLength(0);
  });

  it("checks all three dimensions and labels each breach with its dimension", () => {
    const breaches = findBreaches(insightsWith({
      byProduct: [facet("SH-022", 82, 31)],
      byArea: [facet("Mirpur 11", 84, 26)],
      byCourier: [facet("Sundarban Courier", 84, 26)]
    }));
    expect(breaches.map((b) => `${b.dimension}:${b.facet.key}`)).toEqual([
      "SKU:SH-022",
      "AREA:Mirpur 11",
      "COURIER:Sundarban Courier"
    ]);
  });
});

describe("isoWeek", () => {
  it("numbers a mid-year date", () => {
    expect(isoWeek(new Date("2026-09-15T08:00:00Z"))).toBe("2026-W38");
  });

  it("puts 29 Dec 2025 in week 1 of 2026 (week-year differs from calendar year)", () => {
    expect(isoWeek(new Date("2025-12-29T12:00:00Z"))).toBe("2026-W01");
  });

  it("puts 1 Jan 2027 in week 53 of 2026", () => {
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });
});

describe("buildAlertKey", () => {
  it("joins dimension, facet key and ISO week", () => {
    expect(buildAlertKey("AREA", "Mirpur 11", new Date("2026-09-15T08:00:00Z"))).toBe("AREA:Mirpur 11:2026-W38");
  });
});

describe("draftExplanation", () => {
  it("explains a SKU from its own returns", () => {
    expect(draftExplanation("SKU", facet("SH-022", 82, 31, 44950, "Canvas Sneaker"), sneakerCases)).toBe(
      "31 of 82 Canvas Sneaker (SH-022) orders were returned (37.8%), ৳44,950. Most came from Mirpur 11 via Sundarban Courier, most often damaged in transit."
    );
  });

  it("explains an area by the product and courier behind it", () => {
    expect(draftExplanation("AREA", facet("Mirpur 11", 84, 26, 38590), mirpurCases)).toBe(
      "26 of 84 orders in Mirpur 11 were returned (31.0%), ৳38,590. Most were Canvas Sneaker (SH-022) via Sundarban Courier, most often damaged in transit."
    );
  });

  it("explains a courier by the product and area behind it", () => {
    expect(draftExplanation("COURIER", facet("Sundarban Courier", 84, 26, 38590), mirpurCases)).toBe(
      "26 of 84 Sundarban Courier orders were returned (31.0%), ৳38,590. Most were Canvas Sneaker (SH-022) in Mirpur 11, most often damaged in transit."
    );
  });

  it("omits the place clause when the facet's returns record no area or courier", () => {
    const bare = rows(6, { sku: "X-1", unitPrice: 100, confirmedReason: "DEFECTIVE" }, "b");
    expect(draftExplanation("SKU", facet("X-1", 20, 6, 600), bare)).toBe(
      "6 of 20 X-1 orders were returned (30.0%), ৳600. Most often defective."
    );
  });

  it("ignores other facets' returns entirely", () => {
    const mixed = [...sneakerCases, ...rows(40, { sku: "TS-104", area: "Uttara", courier: "Paperfly", confirmedReason: "WRONG_SIZE" }, "x")];
    expect(draftExplanation("SKU", facet("SH-022", 82, 31, 44950, "Canvas Sneaker"), mixed)).toContain("Mirpur 11 via Sundarban Courier");
  });
});

describe("buildAlert", () => {
  it("builds every stored field from the breach and its own returns", () => {
    const other = rows(3, { sku: "TS-104", area: "Uttara", courier: "Paperfly" }, "other");
    const alert = buildAlert(
      { dimension: "SKU", facet: facet("SH-022", 82, 31, 44950, "Canvas Sneaker") },
      [...sneakerCases, ...other],
      new Date("2026-09-15T08:00:00Z")
    );
    expect(alert.alertKey).toBe("SKU:SH-022:2026-W38");
    expect(alert.dimension).toBe("SKU");
    expect(alert.value).toBe("SH-022");
    expect(alert.metric).toBe(37.8);
    expect(alert.threshold).toBe(30);
    expect(alert.takaImpact).toBe(44950);
    expect(alert.contributingReturnIds).toHaveLength(31);
    expect(alert.contributingReturnIds.some((id) => id.startsWith("other"))).toBe(false);
    expect(alert.raisedAt).toBe("2026-09-15T08:00:00.000Z");
    expect(alert.acknowledgedBy).toBe("");
    expect(alert.draftExplanation.length).toBeGreaterThan(0);
  });
});

describe("classifyAlertInsert", () => {
  it("recognises a successful insert", () => {
    expect(classifyAlertInsert({ data: { insertPatternAlert: { itemId: "a1", acknowledged: true } } })).toBe("inserted");
  });

  it("treats a uniqueness rejection on alertKey as already raised, not a failure", () => {
    expect(classifyAlertInsert({
      data: { insertPatternAlert: null },
      errors: [{ message: "A record with the same value for 'alertKey' already exists." }]
    })).toBe("duplicate");
  });

  it("treats any other error as a failure", () => {
    expect(classifyAlertInsert({ errors: [{ message: "AUTH_NOT_AUTHENTICATED" }] })).toBe("failed");
  });

  it("treats a null payload with no errors as a failure", () => {
    expect(classifyAlertInsert({ data: { insertPatternAlert: null } })).toBe("failed");
  });

  it("treats an unacknowledged payload as a failure", () => {
    expect(classifyAlertInsert({ data: { insertPatternAlert: { itemId: "a1", acknowledged: false } } })).toBe("failed");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/features/insights/patternWatch.test.ts`
Expected: FAIL — cannot resolve `./patternWatch`.

- [ ] **Step 3: Implement** — `app/src/features/insights/patternWatch.ts`

```typescript
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
// as a 200 with a GraphQL errors array and a null payload.
export function classifyAlertInsert(response: unknown): InsertOutcome {
  const r = (response ?? {}) as {
    errors?: unknown;
    data?: { insertPatternAlert?: { itemId?: string; acknowledged?: boolean } | null };
  };
  const errors = Array.isArray(r.errors) ? r.errors : [];
  if (errors.length > 0) {
    const text = JSON.stringify(errors);
    return text.includes("alertKey") && text.toLowerCase().includes("already exists") ? "duplicate" : "failed";
  }
  const payload = r.data?.insertPatternAlert;
  return payload?.itemId && payload.acknowledged !== false ? "inserted" : "failed";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/features/insights/patternWatch.test.ts`
Expected: 20 tests pass.

- [ ] **Step 5: Full suite, lint, build, commit**

Run: `cd app && npm test && npm run lint && npm run build` — expected: 67 tests pass, lint and build clean.

```bash
git add app/src/features/insights/patternWatch.ts app/src/features/insights/patternWatch.test.ts
git commit -m "feat(insights): pure Pattern Watch detection, keys and drafted explanations"
```

---

### Task 3: Notification helpers, inbox mapping and strings (TDD)

**Files:**
- Create: `app/src/lib/blocks/notify.ts`, `app/src/lib/blocks/notify.test.ts`, `app/src/app/layout/describeNotification.ts`, `app/src/app/layout/describeNotification.test.ts`
- Modify: the three i18n files

**Interfaces:**
- Produces:
  - `NOTIFICATION_CONFIGURATION = "shopreturn"`
  - `type NotificationKind = "RETURN_SUBMITTED" | "PATTERN_ALERT"`
  - `buildNotifyRequest(role: string, kind: NotificationKind, payload: Record<string, string | number>): NotifyRequest`
  - `notifyFailed(response: unknown): boolean`
  - `notifyRole(role: string, kind: NotificationKind, payload: Record<string, string | number>): Promise<boolean>`
  - `type NotificationItem = { id?: string; isRead?: boolean; createdTime?: string; denormalizedPayload?: unknown }`
  - `type NotificationView = { key: TranslationKey; replacements: Record<string, string>; href?: string }`
  - `describeNotification(item: NotificationItem): NotificationView`

- [ ] **Step 1: Add the strings to all three dictionaries**

Add these keys to `app/src/lib/i18n/dictionary.ts`, `app/blocks/localization/common.en.json` (English column) and `app/blocks/localization/common.bn.json` (Bangla column):

| key | en | bn |
|---|---|---|
| `notifications.title` | Notifications | নোটিফিকেশন |
| `notifications.empty` | You're all caught up. | নতুন কোনো নোটিফিকেশন নেই। |
| `notifications.loadError` | Could not load notifications. | নোটিফিকেশন লোড করা যায়নি। |
| `notifications.markAllRead` | Mark all read | সব পড়া হয়েছে চিহ্নিত করুন |
| `notifications.unread` | unread | অপঠিত |
| `notifications.returnSubmitted` | New return for order {orderNumber} | অর্ডার {orderNumber}-এর জন্য নতুন রিটার্ন |
| `notifications.patternAlert` | {value} return rate is {metric}% | {value}-এর রিটার্ন হার {metric}% |
| `notifications.generic` | New notification | নতুন নোটিফিকেশন |

Change the existing value of `insights.alerts.draftLabel` in all three files: en `Drafted from the return data, not yet confirmed`, bn `রিটার্নের তথ্য থেকে খসড়া, এখনও নিশ্চিত নয়`.

Run: `cd app && node scripts/i18n-parity.mjs` — expected: equal counts (245 each) and exit 0.

- [ ] **Step 2: Write the failing tests**

`app/src/lib/blocks/notify.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildNotifyRequest, notifyFailed } from "./notify";

describe("buildNotifyRequest", () => {
  it("fills the five fields the notifier requires, verbatim", () => {
    expect(buildNotifyRequest("ops", "RETURN_SUBMITTED", { returnId: "r1", orderNumber: "10-4825" })).toEqual({
      configurationName: "shopreturn",
      connectionId: "",
      responseKey: "shopreturn",
      responseValue: "RETURN_SUBMITTED",
      roles: ["ops"],
      denormalizedPayload: JSON.stringify({ kind: "RETURN_SUBMITTED", returnId: "r1", orderNumber: "10-4825" }),
      saveDenormalizedPayloadAsAnObject: true
    });
  });
});

describe("notifyFailed", () => {
  it("accepts the live success shape", () => {
    expect(notifyFailed({ errors: null, isSuccess: true })).toBe(false);
  });

  it("fails on isSuccess false", () => {
    expect(notifyFailed({ isSuccess: false })).toBe(true);
  });

  it("fails on an errors object with keys (the missing-configuration shape)", () => {
    expect(notifyFailed({ errors: { ConfigurationName: "no_configuration_exist" }, isSuccess: false })).toBe(true);
    expect(notifyFailed({ errors: { ConfigurationName: "no_configuration_exist" } })).toBe(true);
  });

  it("fails on a non-empty errors array", () => {
    expect(notifyFailed({ errors: [{ message: "boom" }] })).toBe(true);
  });

  it("fails when there is no response at all", () => {
    expect(notifyFailed(undefined)).toBe(true);
  });
});
```

`app/src/app/layout/describeNotification.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { describeNotification } from "./describeNotification";

describe("describeNotification", () => {
  it("links a submitted return to its review page", () => {
    expect(describeNotification({ denormalizedPayload: { kind: "RETURN_SUBMITTED", returnId: "r 1", orderNumber: "10-4825" } })).toEqual({
      key: "notifications.returnSubmitted",
      replacements: { orderNumber: "10-4825" },
      href: "/ops/review?id=r%201"
    });
  });

  it("links a pattern alert to Analytics", () => {
    expect(describeNotification({ denormalizedPayload: { kind: "PATTERN_ALERT", value: "Mirpur 11", metric: 31 } })).toEqual({
      key: "notifications.patternAlert",
      replacements: { value: "Mirpur 11", metric: "31" },
      href: "/insights"
    });
  });

  it("parses a payload that arrives as a JSON string", () => {
    expect(describeNotification({ denormalizedPayload: JSON.stringify({ kind: "PATTERN_ALERT", value: "SH-022", metric: 37.8 }) }).key).toBe("notifications.patternAlert");
  });

  it("renders an unknown kind generically, without a link", () => {
    expect(describeNotification({ denormalizedPayload: { kind: "SOMETHING_NEW" } })).toEqual({ key: "notifications.generic", replacements: {} });
  });

  it("survives a malformed payload", () => {
    expect(describeNotification({ denormalizedPayload: "{not json" })).toEqual({ key: "notifications.generic", replacements: {} });
  });

  it("does not link a submitted return that has no id", () => {
    expect(describeNotification({ denormalizedPayload: { kind: "RETURN_SUBMITTED", orderNumber: "10-4825" } }).key).toBe("notifications.generic");
  });
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `cd app && npx vitest run src/lib/blocks/notify.test.ts src/app/layout/describeNotification.test.ts`
Expected: FAIL — cannot resolve `./notify` and `./describeNotification`.

- [ ] **Step 4: Implement** — `app/src/lib/blocks/notify.ts`

```typescript
import { blocksClient } from "./client";

export const NOTIFICATION_CONFIGURATION = "shopreturn";

export type NotificationKind = "RETURN_SUBMITTED" | "PATTERN_ALERT";

export type NotifyRequest = {
  configurationName: string;
  connectionId: string;
  responseKey: string;
  responseValue: string;
  roles: string[];
  denormalizedPayload: string;
  saveDenormalizedPayloadAsAnObject: boolean;
};

// The notifier requires all five of configurationName, connectionId,
// responseKey, responseValue and denormalizedPayload, even though the SDK
// types mark them optional. "" is an accepted connectionId.
export function buildNotifyRequest(role: string, kind: NotificationKind, payload: Record<string, string | number>): NotifyRequest {
  return {
    configurationName: NOTIFICATION_CONFIGURATION,
    connectionId: "",
    responseKey: NOTIFICATION_CONFIGURATION,
    responseValue: kind,
    roles: [role],
    denormalizedPayload: JSON.stringify({ kind, ...payload }),
    saveDenormalizedPayloadAsAnObject: true
  };
}

// A missing configuration comes back as a 200 with isSuccess false and an
// errors OBJECT, not an HTTP error -- every failure shape must be checked.
export function notifyFailed(response: unknown): boolean {
  if (!response || typeof response !== "object") return true;
  const r = response as { errors?: unknown; isSuccess?: unknown };
  if (r.isSuccess === false) return true;
  if (Array.isArray(r.errors)) return r.errors.length > 0;
  if (r.errors && typeof r.errors === "object") return Object.keys(r.errors).length > 0;
  return false;
}

// Fire-and-forget by contract: callers send AFTER their own write has
// landed, and a failed notification must never undo or block that write.
export async function notifyRole(role: string, kind: NotificationKind, payload: Record<string, string | number>): Promise<boolean> {
  try {
    const response = await blocksClient.notifier.notify(buildNotifyRequest(role, kind, payload));
    if (notifyFailed(response)) {
      console.warn(`[notify] ${kind} to ${role} was not accepted`, response);
      return false;
    }
    return true;
  } catch (caught) {
    console.warn(`[notify] ${kind} to ${role} failed`, caught);
    return false;
  }
}
```

`app/src/app/layout/describeNotification.ts`:

```typescript
import type { TranslationKey } from "../../lib/i18n/dictionary";

export type NotificationItem = {
  id?: string;
  isRead?: boolean;
  createdTime?: string;
  denormalizedPayload?: unknown;
};

export type NotificationView = {
  key: TranslationKey;
  replacements: Record<string, string>;
  href?: string;
};

function payloadOf(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

// Unknown kinds render generically instead of crashing the menu: a newer
// sender must never break an older bell.
export function describeNotification(item: NotificationItem): NotificationView {
  const payload = payloadOf(item.denormalizedPayload);
  if (payload.kind === "RETURN_SUBMITTED" && text(payload.returnId)) {
    return {
      key: "notifications.returnSubmitted",
      replacements: { orderNumber: text(payload.orderNumber) },
      href: `/ops/review?id=${encodeURIComponent(text(payload.returnId))}`
    };
  }
  if (payload.kind === "PATTERN_ALERT") {
    return {
      key: "notifications.patternAlert",
      replacements: { value: text(payload.value), metric: text(payload.metric) },
      href: "/insights"
    };
  }
  return { key: "notifications.generic", replacements: {} };
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd app && npx vitest run src/lib/blocks/notify.test.ts src/app/layout/describeNotification.test.ts`
Expected: 12 tests pass.

- [ ] **Step 6: Full suite, lint, build, parity, commit**

Run: `cd app && npm test && npm run lint && npm run build && node scripts/i18n-parity.mjs` — expected: 79 tests pass; all clean; parity exit 0.

```bash
git add app/src/lib/blocks/notify.ts app/src/lib/blocks/notify.test.ts app/src/app/layout/describeNotification.ts app/src/app/layout/describeNotification.test.ts app/src/lib/i18n/dictionary.ts app/blocks/localization/common.en.json app/blocks/localization/common.bn.json
git commit -m "feat(notifications): notify helper, inbox item mapping and strings"
```

---

### Task 4: Data model, access policy and fixture backfill (cloud — approval required)

**Files:**
- Modify: `blocks/data/schemas/PatternAlert.json`, `blocks/data/rules.json`
- Create: `tools/access-check/backfill-pattern-alert-key.mjs`, `tools/access-check/probe-alert-key-uniqueness.mjs`

**Interfaces:**
- Produces: live `PatternAlert.alertKey` (unique) and policy `ops-inserts-pattern-alerts`; fixture alert keyed `SKU:SH-022:<current ISO week>`.

- [ ] **Step 1: Add the field** — in `blocks/data/schemas/PatternAlert.json`, add to `fields`, directly after `acknowledgedBy`:

```json
{ "name": "alertKey", "type": "String", "isUniqueData": true, "description": "DIMENSION:facetKey:ISO-week, e.g. AREA:Mirpur 11:2026-W38. Unique, so a second insert for the same facet in the same week is rejected by the database." }
```

- [ ] **Step 2: Add the policy** — append to the `policies` array in `blocks/data/rules.json`:

```json
{
  "schemaName": "PatternAlert",
  "policyName": "ops-inserts-pattern-alerts",
  "policyDescription": "Ops may create PatternAlert rows (Pattern Watch runs in the ops browser on accept) but still cannot read or edit them.",
  "policyType": 0,
  "operation": 1,
  "isAllowPolicy": true,
  "priority": 20,
  "fieldNames": [],
  "ruleGroup": {
    "logicalOperator": 0,
    "nestedGroups": [],
    "rules": [
      { "leftSource": 0, "leftOperand": "roles", "operator": 0, "rightSource": 2, "staticValue": "ops" }
    ]
  }
}
```

The `security[]` entries for `PatternAlert` (schema id `84171f54-5a49-4b4e-833e-0ad8e90e41b8`) already set insert to access level 3, so this policy will evaluate. Do not change `security[]`.

- [ ] **Step 3: Validate locally**

Run: `blocks data validate --json` — expected: `"ok": true`, no errors.

- [ ] **Step 4: Dry-run the sync, then STOP for approval**

Run: `blocks data sync --dry-run --json`
Report its full output with status **NEEDS_CONTEXT**. Do **not** run `--yes`. The controller obtains the user's approval and runs `blocks data sync --yes --json`, then resumes you.

- [ ] **Step 5: Verify both changes are live, through reads**

```bash
blocks data rules policy get PatternAlert --json
blocks data schema aggregation --json
```

Expected: the policy list for `PatternAlert` includes `ops-inserts-pattern-alerts` with operation 1; the aggregation entry for collection `blx_PatternAlerts` has a field `alertKey` with `"isUniqueData": true`. If `alertKey` is absent or not unique, stop and report — Step 7 must not run.

- [ ] **Step 6: Backfill the fixture alert** — create `tools/access-check/backfill-pattern-alert-key.mjs`:

```javascript
import { signIn } from './client.mjs';

// One-off migration: give the pre-existing SH-022 fixture alert its alertKey
// so the first Pattern Watch run does not raise a duplicate SH-022 alert.
// isoWeek matches app/src/features/insights/patternWatch.ts exactly.
const ALERT_ID = 'ee6d9ac1-9451-4f2b-b9ea-e762fa7b3eaf';

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const weekYear = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(weekYear, 0, 1)) / 86400000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

const key = `SKU:SH-022:${isoWeek(new Date())}`;
const { blocks: manager } = await signIn(process.env.SHOPRETURN_MANAGER_EMAIL, process.env.SHOPRETURN_MANAGER_PASSWORD);

const res = await manager.data.collection('PatternAlert').update(ALERT_ID, { alertKey: key });
const failed = (Array.isArray(res?.errors) && res.errors.length > 0) || res?.isSuccess === false || !res?.data?.updatePatternAlert?.itemId;
if (failed) {
  console.log('BACKFILL FAILED', JSON.stringify(res).slice(0, 300));
  process.exit(1);
}

const list = await manager.data.collection('PatternAlert', { fields: ['alertKey', 'dimension', 'value'] }).list({ pageNo: 1, pageSize: 50 });
const rows = list?.data?.getPatternAlerts?.items ?? [];
const fixture = rows.find((row) => row.ItemId === ALERT_ID);
console.log('fixture alertKey now:', fixture?.alertKey);
console.log('alerts total:', rows.length);
process.exit(fixture?.alertKey === key ? 0 : 1);
```

Run: `cd tools/access-check && node --env-file=.env backfill-pattern-alert-key.mjs`
Expected: `fixture alertKey now: SKU:SH-022:<week>`, exit 0.

- [ ] **Step 7: Prove ops can insert and the key is unique — without creating a row**

Create `tools/access-check/probe-alert-key-uniqueness.mjs`:

```javascript
import { signIn } from './client.mjs';

// Proves two things at once with zero debris: ops' insert right on
// PatternAlert is live, and alertKey uniqueness is enforced. An ops insert
// reusing the fixture's key must be REJECTED FOR UNIQUENESS -- which it can
// only be if the insert policy let it through to that check. A 401 means the
// policy is not live. A created row means uniqueness is not enforced, and
// because no role can delete an alert, that row would be permanent: report it.
const ALERT_ID = 'ee6d9ac1-9451-4f2b-b9ea-e762fa7b3eaf';

const { blocks: manager } = await signIn(process.env.SHOPRETURN_MANAGER_EMAIL, process.env.SHOPRETURN_MANAGER_PASSWORD);
const list = await manager.data.collection('PatternAlert', { fields: ['alertKey'] }).list({ pageNo: 1, pageSize: 50 });
const key = (list?.data?.getPatternAlerts?.items ?? []).find((row) => row.ItemId === ALERT_ID)?.alertKey;
if (!key) {
  console.log('ABORT: the fixture alert has no alertKey yet -- run the backfill first. Nothing was inserted.');
  process.exit(1);
}

const { blocks: ops } = await signIn(process.env.SHOPRETURN_OPS_EMAIL, process.env.SHOPRETURN_OPS_PASSWORD);
let res;
try {
  res = await ops.data.collection('PatternAlert').create({
    alertKey: key, dimension: 'SKU', value: 'SH-022', metric: 0, threshold: 30, takaImpact: 0,
    contributingReturnIds: [], draftExplanation: 'uniqueness probe -- must be rejected',
    raisedAt: new Date().toISOString(), acknowledgedBy: ''
  });
} catch (error) {
  const denied = /\b(401|403)\b/.test(error.message);
  console.log(denied ? 'FAIL: ops insert DENIED -- the policy is not live' : `INCONCLUSIVE: ${error.message}`);
  process.exit(1);
}

const errors = JSON.stringify(res?.errors ?? []);
const created = res?.data?.insertPatternAlert?.itemId;
if (created) {
  console.log(`FAIL: a duplicate alert was CREATED (itemId=${created}) -- uniqueness is not enforced. No role can delete it; remove it by hand.`);
  process.exit(1);
}
if (errors.includes('alertKey') && errors.toLowerCase().includes('already exists')) {
  console.log('PASS: ops insert reached the uniqueness check and was rejected for a duplicate alertKey. Nothing was created.');
  process.exit(0);
}
console.log('INCONCLUSIVE:', JSON.stringify(res).slice(0, 300));
process.exit(1);
```

Run: `cd tools/access-check && node --env-file=.env probe-alert-key-uniqueness.mjs`
Expected: `PASS …`, exit 0. Anything else: stop and report verbatim.

- [ ] **Step 8: Harness still green**

Run: `cd tools/access-check && node --env-file=.env assertions.mjs` — expected: `13/14 passing`, only #7 red.

- [ ] **Step 9: Commit**

```bash
git add blocks/data/schemas/PatternAlert.json blocks/data/rules.json tools/access-check/backfill-pattern-alert-key.mjs tools/access-check/probe-alert-key-uniqueness.mjs
git commit -m "feat(data): unique PatternAlert.alertKey and insert-only grant for ops"
```

---

### Task 5: Run Pattern Watch after an accept

**Files:**
- Create: `app/src/features/insights/runPatternWatch.ts`
- Modify: `app/src/features/ops/useReviewReturn.ts`

**Interfaces:**
- Consumes: `loadInsightsData` (Task 1), `computeInsights`, `findBreaches`, `buildAlert`, `classifyAlertInsert`, `InsertOutcome` (Task 2), `notifyRole` (Task 3).
- Produces: `type PatternWatchResult = { inserted: string[]; duplicate: string[]; failed: string[]; error?: string }`; `runPatternWatch(now?: Date): Promise<PatternWatchResult>` — never throws.

- [ ] **Step 1: Create `app/src/features/insights/runPatternWatch.ts`**

```typescript
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
```

- [ ] **Step 2: Wire it into the accept** — in `app/src/features/ops/useReviewReturn.ts`

Add `import { runPatternWatch } from "../insights/runPatternWatch";` with the other imports. In `accept`, immediately after the block

```typescript
      if (!updated) {
        setSubmitStage("update-failed");
        return false;
      }
```

insert:

```typescript
      // The accept has landed, so re-check the return rates (design spec §1).
      // Fire-and-forget by design: detection must never delay, block or undo
      // the case decision ops just made.
      void runPatternWatch().then((summary) => {
        if (summary.error || summary.failed.length > 0) console.warn("[pattern-watch]", summary);
        else if (summary.inserted.length > 0) console.info("[pattern-watch] raised", summary.inserted);
      });
```

Change nothing else in `accept`, and do not wire detection into `reject`.

- [ ] **Step 3: Verify**

Run: `cd app && npm test && npm run lint && npm run build` — expected: 79 tests pass, lint and build clean. Confirm by reading that `runPatternWatch` is not awaited in `accept`, and that `reject` is untouched.

- [ ] **Step 4: Commit**

```bash
git add app/src/features/insights/runPatternWatch.ts app/src/features/ops/useReviewReturn.ts
git commit -m "feat(ops): run Pattern Watch after an accept lands"
```

---

### Task 6: Notify ops on submit, and a live bell

**Files:**
- Create: `app/src/app/layout/useNotifications.ts`
- Replace: `app/src/app/layout/NotificationsMenu.tsx`
- Modify: `app/src/app/layout/AppShell.tsx`, `app/src/features/returns/useSubmitReturn.ts`, `app/src/app/styles.css`

**Interfaces:**
- Consumes: `notifyRole` (Task 3); `describeNotification`, `NotificationItem` (Task 3).
- Produces: `useNotifications(pollMs?: number): { items: NotificationItem[]; unread: number; error?: string; loading: boolean; refresh(): Promise<void>; markRead(id: string): Promise<void>; markAllRead(): Promise<void> }`; `NotificationsMenu({ onNavigate }: { onNavigate: (path: string) => void })`.

- [ ] **Step 1: Notify ops after a successful submit** — in `app/src/features/returns/useSubmitReturn.ts`

Add `import { notifyRole } from "../../lib/blocks/notify";`. Immediately before `return { itemId: inserted.itemId, photoFailures };` insert:

```typescript
      // The return exists now; tell ops. Fire-and-forget: a failed ping must
      // never turn a successful submission into an error for the customer.
      void notifyRole("ops", "RETURN_SUBMITTED", {
        returnId: inserted.itemId,
        orderNumber: input.orderNumber,
        productName: input.productName ?? ""
      });
```

If `input.productName` is typed as a non-optional `string`, drop `?? ""`.

- [ ] **Step 2: Create `app/src/app/layout/useNotifications.ts`**

```typescript
import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import type { NotificationItem } from "./describeNotification";

// The SDK has no real-time client, so the bell reads the persisted inbox and
// refreshes on open, on focus, and on an interval while the tab is visible.
// getNotifications is ZERO-indexed: page 1 of a one-page inbox is empty.
export function useNotifications(pollMs = 30_000) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await blocksClient.notifier.getNotifications({ page: 0, pageSize: 20 });
      // A missing list is a failed read, not an empty inbox.
      if (!res || !Array.isArray(res.notifications)) throw new Error("notifications missing from response");
      setItems(res.notifications as NotificationItem[]);
      setUnread(typeof res.unReadNotificationsCount === "number" ? res.unReadNotificationsCount : 0);
      setError(undefined);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const whenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(whenVisible, pollMs);
    window.addEventListener("focus", whenVisible);
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", whenVisible);
      document.removeEventListener("visibilitychange", whenVisible);
    };
  }, [refresh, pollMs]);

  const markRead = useCallback(async (id: string) => {
    try {
      await blocksClient.notifier.markNotificationAsRead({ id });
    } finally {
      await refresh();
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    try {
      await blocksClient.notifier.markAllNotificationAsRead();
    } finally {
      await refresh();
    }
  }, [refresh]);

  return { items, unread, error, loading, refresh, markRead, markAllRead };
}
```

- [ ] **Step 3: Replace `app/src/app/layout/NotificationsMenu.tsx`**

```tsx
import { Bell, CheckCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../../shared/ui/dropdown-menu";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { describeNotification } from "./describeNotification";
import { useNotifications } from "./useNotifications";

export function NotificationsMenu({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useT();
  const { items, unread, error, markRead, markAllRead, refresh } = useNotifications();
  const badge = unread > 9 ? "9+" : String(unread);
  const triggerLabel = unread > 0
    ? `${t("notifications.title")} (${unread} ${t("notifications.unread")})`
    : t("notifications.title");

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) void refresh(); }}>
      <DropdownMenuTrigger className="icon-button notif-trigger" aria-label={triggerLabel}>
        <Bell size={18} />
        {unread > 0 ? <span className="notif-badge" aria-hidden="true">{badge}</span> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="notif-menu">
        <div className="notif-header">
          <DropdownMenuLabel>{t("notifications.title")}</DropdownMenuLabel>
          {unread > 0 ? (
            <button type="button" className="notif-mark-all" onClick={() => void markAllRead()}>
              {t("notifications.markAllRead")}
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {error ? (
          // A failed read must never be shown as "all caught up".
          <p className="notif-error" role="alert">{t("notifications.loadError")}</p>
        ) : items.length === 0 ? (
          <div className="notif-empty">
            <CheckCheck size={22} aria-hidden="true" />
            <p>{t("notifications.empty")}</p>
          </div>
        ) : (
          items.map((item, index) => {
            const view = describeNotification(item);
            const sentence = Object.entries(view.replacements).reduce(
              (acc, [name, value]) => acc.replace(`{${name}}`, value),
              t(view.key)
            );
            return (
              <DropdownMenuItem
                key={item.id ?? `notification-${index}`}
                className={item.isRead ? "notif-item" : "notif-item notif-item-unread"}
                onSelect={() => {
                  if (item.id && !item.isRead) void markRead(item.id);
                  if (view.href) onNavigate(view.href);
                }}
              >
                {!item.isRead ? <span className="notif-unread-marker">{t("notifications.unread")}</span> : null}
                <span className="notif-text">{sentence}</span>
                {item.createdTime ? <span className="notif-time">{new Date(item.createdTime).toLocaleString()}</span> : null}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Pass navigation to the bell** — in `app/src/app/layout/AppShell.tsx`, change `<NotificationsMenu />` to `<NotificationsMenu onNavigate={onNavigate} />`.

- [ ] **Step 5: Styles** — append to `app/src/app/styles.css`:

```css
/* ---- Notifications bell ------------------------------------------------ */
.notif-trigger { position: relative; }
.notif-badge {
  background: var(--warn); border-radius: 999px; color: #FFFFFF; font-size: 10px; font-weight: 700;
  line-height: 16px; min-width: 16px; padding: 0 4px; position: absolute; right: 2px; text-align: center; top: 2px;
}
.notif-menu { max-height: min(70vh, 480px); max-width: calc(100vw - 32px); overflow-y: auto; width: 340px; }
.notif-header { align-items: center; display: flex; gap: 8px; justify-content: space-between; padding-right: 8px; }
.notif-mark-all {
  background: transparent; border: 0; color: var(--brand); cursor: pointer; font-size: 12px; font-weight: 600; padding: 4px;
}
.notif-mark-all:hover { color: var(--brand-ink); text-decoration: underline; }
.notif-item { align-items: flex-start; display: grid; gap: 2px; padding: 8px 12px; }
.notif-item-unread .notif-text { color: var(--text); font-weight: 600; }
.notif-unread-marker { color: var(--brand); font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.notif-text { color: var(--text-muted); font-size: 13px; line-height: 1.4; }
.notif-time { color: var(--text-faint); font-size: 11px; }
.notif-empty { align-items: center; color: var(--text-muted); display: grid; gap: 8px; justify-items: center; padding: 24px 12px; text-align: center; }
.notif-error { color: var(--warn); font-size: 13px; margin: 0; padding: 16px 12px; }
```

- [ ] **Step 6: Verify**

Run: `cd app && npm test && npm run lint && npm run build && node scripts/i18n-parity.mjs` — expected: 79 tests pass; all clean; parity exit 0. Confirm by reading: the bell requests `page: 0`; an error renders the error line, not the empty state; unread items carry both a weight change and a text marker; `useSubmitReturn` does not await `notifyRole`.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/layout/useNotifications.ts app/src/app/layout/NotificationsMenu.tsx app/src/app/layout/AppShell.tsx app/src/features/returns/useSubmitReturn.ts app/src/app/styles.css
git commit -m "feat(notifications): notify ops on submit and read the inbox in the bell"
```

---

### Task 7: Lock the boundaries, ship, and verify end to end (cloud — approval required)

**Files:**
- Modify: `tools/access-check/assertions.mjs`
- Create: `tools/access-check/verify-pattern-watch.mjs`

- [ ] **Step 1: Add assertions #15 and #16** — in `tools/access-check/assertions.mjs`, after assertion #14's block and before the tally. The fixture alert id is in the existing `fixtureIds` object as `patternAlertItemId`; read how the harness already loads `fixtureIds` and use that value.

```javascript
  // 15. The insert grant is ops-only. A customer creating an alert would put
  // words in the manager's alert strip. Must be denied, so nothing is created.
  {
    const label = "customerA cannot insert a PatternAlert";
    const result = await attempt(() =>
      blocksA.data.collection("PatternAlert").create({
        alertKey: `PROBE:assertion-15:${Date.now()}`,
        dimension: "SKU",
        value: "assertion-15-probe",
        metric: 0,
        threshold: 30,
        takaImpact: 0,
        contributingReturnIds: [],
        draftExplanation: "assertion 15 probe -- must be denied",
        raisedAt: new Date().toISOString(),
        acknowledgedBy: ""
      })
    );
    const created = result.response?.data?.insertPatternAlert?.itemId;
    if (isAuthDenial(result)) {
      record(15, label, true, `denied(${result.message})`);
    } else if (created) {
      record(15, label, false, `allowed -- PatternAlert created (itemId=${created}); no role can delete it, remove it by hand`);
    } else {
      record(15, label, false, `inconclusive -- not an auth denial: ${result.message ?? JSON.stringify(result.response)}`);
    }
  }

  // 16. Acknowledging stays manager-only: ops creates alerts but must not be
  // able to change them. Non-destructive: writes back the value the manager
  // reads right now, so even a wrongly-allowed write changes nothing.
  {
    const label = "ops cannot update a PatternAlert";
    const current = await attempt(() =>
      blocksManager.data.collection("PatternAlert", { fields: ["acknowledgedBy"] }).list({ pageNo: 1, pageSize: 50 })
    );
    const row = itemsOf(current.response, "getPatternAlerts").find((item) => item.ItemId === fixtureIds.patternAlertItemId);
    if (!row) {
      record(16, label, false, "vacuous -- the manager could not read the fixture alert, so the probe would prove nothing");
    } else {
      const result = await attempt(() =>
        blocksOps.data.collection("PatternAlert").update(fixtureIds.patternAlertItemId, { acknowledgedBy: row.acknowledgedBy ?? "" })
      );
      if (isAuthDenial(result)) {
        record(16, label, true, `denied(${result.message})`);
      } else if (result.outcome === "ok") {
        record(16, label, false, `allowed -- updatePatternAlert=${JSON.stringify(result.response?.data?.updatePatternAlert)}`);
      } else {
        record(16, label, false, `inconclusive -- not an auth denial: ${result.message}`);
      }
    }
  }
```

If the harness loads fixture ids under a different variable name than `fixtureIds`, use that name; do not add a second load.

- [ ] **Step 2: Run the harness**

Run: `cd tools/access-check && node --env-file=.env assertions.mjs`
Expected: **15/16 passing**, only #7 red. Commit:

```bash
git add tools/access-check/assertions.mjs
git commit -m "test(access-check): only ops may create alerts, only the manager may change them"
```

- [ ] **Step 3: Localization — dry-run, then STOP for approval**

Run, from `app/`: `blocks localization push --module common --language en-US --file blocks/localization/common.en.json --project Df53833214f2a4243b696b55040b32509 --account default --dry-run --json`, and the same for `bn-BD` with `common.bn.json`. Report both with status **NEEDS_CONTEXT**. The controller obtains approval, runs both with `--yes` in sequence (same module — never in parallel), and resumes you.

After resuming, verify through the app's read path: with a signed-in client, `translations("common", "en-US")` and `translations("common", "bn-BD")` each return `notifications.returnSubmitted`, `notifications.patternAlert` and the reworded `insights.alerts.draftLabel` with the table's text.

- [ ] **Step 4: Push and deploy — dry-run, then STOP for approval**

Run `git push origin dev`. Then `blocks release deploy --repo 6ea7f662-94cf-47e0-85e5-0df21be24aab --dry-run --json` and report with status **NEEDS_CONTEXT**. The controller obtains approval and runs `blocks release deploy --repo 6ea7f662-94cf-47e0-85e5-0df21be24aab --wait --json`, then resumes you.

After resuming, confirm: `blocks release builds list 6ea7f662-94cf-47e0-85e5-0df21be24aab --page-size 1 --json` shows the newest build `Succeeded`, and the live bundle at `https://dbzjdy-eljlh.slsblx.com` contains the string `PATTERN_ALERT`.

- [ ] **Step 5: Create the read-only verifier** — `tools/access-check/verify-pattern-watch.mjs`

```javascript
import { signIn } from './client.mjs';

// Read-only end-to-end check, run AFTER a human has (1) submitted a return as
// customer A and (2) accepted it as ops on the deployed site. It never writes.
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const weekYear = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(weekYear, 0, 1)) / 86400000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

const orderNumber = process.argv[2];
const week = isoWeek(new Date());
const results = [];
const check = (label, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${label} -- ${detail}`); };

const { blocks: manager } = await signIn(process.env.SHOPRETURN_MANAGER_EMAIL, process.env.SHOPRETURN_MANAGER_PASSWORD);
const { blocks: ops } = await signIn(process.env.SHOPRETURN_OPS_EMAIL, process.env.SHOPRETURN_OPS_PASSWORD);

const alertList = await manager.data.collection('PatternAlert', {
  fields: ['alertKey', 'dimension', 'value', 'metric', 'threshold', 'draftExplanation', 'contributingReturnIds']
}).list({ pageNo: 1, pageSize: 100 });
const alerts = alertList?.data?.getPatternAlerts?.items ?? [];

for (const [dimension, value] of [['AREA', 'Mirpur 11'], ['COURIER', 'Sundarban Courier']]) {
  const key = `${dimension}:${value}:${week}`;
  const matches = alerts.filter((a) => a.alertKey === key);
  const a = matches[0];
  check(`exactly one alert ${key}`, matches.length === 1, `found ${matches.length}`);
  if (a) {
    check(`${key} fields`, a.dimension === dimension && a.value === value && a.threshold === 30 && a.metric >= 30,
      `dimension=${a.dimension} value=${a.value} metric=${a.metric} threshold=${a.threshold}`);
    check(`${key} explanation drafted`, typeof a.draftExplanation === 'string' && a.draftExplanation.includes(value), a.draftExplanation);
    check(`${key} links its returns`, Array.isArray(a.contributingReturnIds) && a.contributingReturnIds.length > 0, `${a.contributingReturnIds?.length ?? 0} ids`);
  }
}
const shKey = `SKU:SH-022:${week}`;
check('SH-022 not duplicated', alerts.filter((a) => a.alertKey === shKey).length === 1, `found ${alerts.filter((a) => a.alertKey === shKey).length}`);

const inbox = async (client) => (await client.notifier.getNotifications({ page: 0, pageSize: 50 }))?.notifications ?? [];
const managerInbox = await inbox(manager);
for (const value of ['Mirpur 11', 'Sundarban Courier']) {
  const hit = managerInbox.find((n) => JSON.stringify(n).includes('PATTERN_ALERT') && JSON.stringify(n).includes(value));
  check(`manager notified about ${value}`, Boolean(hit), hit ? `id ${hit.id}` : 'not in inbox (page 0)');
}

if (orderNumber) {
  const opsInbox = await inbox(ops);
  const hit = opsInbox.find((n) => JSON.stringify(n).includes('RETURN_SUBMITTED') && JSON.stringify(n).includes(orderNumber));
  check(`ops notified about order ${orderNumber}`, Boolean(hit), hit ? `id ${hit.id}` : 'not in inbox (page 0)');
}

const passing = results.filter(Boolean).length;
console.log(`${passing}/${results.length} passing`);
process.exit(passing === results.length ? 0 : 1);
```

- [ ] **Step 6: Hand the live run to the human, then verify**

Report status **NEEDS_CONTEXT** asking the controller to have the user, on `https://dbzjdy-eljlh.slsblx.com`: (1) sign in as customer A and submit a return on order `10-4825`; (2) sign in as ops and accept that return. After resuming, run:

`cd tools/access-check && node --env-file=.env verify-pattern-watch.mjs 10-4825`

Expected: every check PASS — one `AREA:Mirpur 11:<week>` and one `COURIER:Sundarban Courier:<week>` alert with correct fields and a drafted explanation, SH-022 not duplicated, the manager notified about both, and ops notified about order `10-4825`. Leave these notifications unread — they are the demo.

- [ ] **Step 7: Commit**

```bash
git add tools/access-check/verify-pattern-watch.mjs
git commit -m "test(access-check): end-to-end verifier for Pattern Watch and notifications"
git push origin dev
```

---

## Self-review notes

- **Spec coverage.** Trigger on accept only (T5); reuse of `computeInsights` via shared loading (T1, T5); thresholds shared with `FacetBars` (T1); `UNSPECIFIED` excluded, minimum orders, threshold (T2); unique weekly `alertKey` and ISO week-year (T2, T4); fixture backfill before detection ships (T4); stored fields (T2, with the `string[]` deviation); explanation from the facet's own returns with omitted clauses and English storage (T2); reworded draft label (T3); insert-only ops grant (T4); `notifyRole` with every failure shape (T3); both sends, fire-and-forget, minimal payloads (T5, T6); bell at page 0, badge, refresh on open/focus/interval, mapping, mark read, mark all read, error distinct from empty, unread not by colour alone (T3, T6); localisation keys and push (T3, T7); assertions #15/#16 with no debris (T7); end-to-end verification (T7).
- **Test counts.** 47 baseline -> 67 after T2 (+20: findBreaches 5, isoWeek 3, buildAlertKey 1, draftExplanation 5, buildAlert 1, classifyAlertInsert 5) -> 79 after T3 (+12: notify 6, describeNotification 6) -> 79 through T6.
- **Names used across tasks.** `listAll`, `loadInsightsData`, `ORDER_FIELDS`, `CASE_FIELDS`, `BREACH_RATE`, `MIN_ORDERS`, `ALERT_THRESHOLD_PERCENT`, `reasonOf`, `Dimension`, `Breach`, `PatternAlertInput`, `InsertOutcome`, `isoWeek`, `buildAlertKey`, `findBreaches`, `draftExplanation`, `buildAlert`, `classifyAlertInsert`, `PatternWatchResult`, `runPatternWatch`, `NOTIFICATION_CONFIGURATION`, `NotificationKind`, `buildNotifyRequest`, `notifyFailed`, `notifyRole`, `NotificationItem`, `NotificationView`, `describeNotification`, `useNotifications`, `NotificationsMenu`.

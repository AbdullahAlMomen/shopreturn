import { describe, expect, it } from "vitest";
import { deriveTableState, filterRows, nextTableState, paginate } from "./useTableControls";
import type { TableState } from "./useTableControls";

type Row = { order: string; product: string; amount: number };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    order: `ORD-${index + 1}`,
    product: `Product ${index + 1}`,
    amount: 1000 + index
  }));
}

const fields = (row: Row) => [row.order, row.product, row.amount];

describe("filterRows", () => {
  it("returns every row when the query is empty", () => {
    const rows = makeRows(5);
    expect(filterRows(rows, "", fields)).toEqual(rows);
  });

  it("returns every row when the query is whitespace-only", () => {
    const rows = makeRows(5);
    expect(filterRows(rows, "   ", fields)).toEqual(rows);
  });

  it("matches case-insensitively as a substring", () => {
    const rows = [
      { order: "ORD-10-48", product: "Canvas Sneaker", amount: 1450 },
      { order: "ORD-99", product: "Leather Tote Bag", amount: 4250 }
    ];
    expect(filterRows(rows, "sneaker", fields)).toEqual([rows[0]]);
    expect(filterRows(rows, "SNEAKER", fields)).toEqual([rows[0]]);
  });

  it("matches number fields as their string form", () => {
    const rows = [
      { order: "ORD-10-48", product: "Canvas Sneaker", amount: 1450 },
      { order: "ORD-99", product: "Leather Tote Bag", amount: 4250 }
    ];
    expect(filterRows(rows, "1450", fields)).toEqual([rows[0]]);
  });

  it("matches an order number containing a dash", () => {
    const rows = [
      { order: "ORD-10-48", product: "Canvas Sneaker", amount: 1450 },
      { order: "ORD-99", product: "Leather Tote Bag", amount: 4250 }
    ];
    expect(filterRows(rows, "10-48", fields)).toEqual([rows[0]]);
  });

  it("ignores undefined field values instead of matching or throwing", () => {
    type Sparse = { order: string; note?: string };
    const rows: Sparse[] = [{ order: "A" }, { order: "B", note: "special" }];
    const sparseFields = (row: Sparse) => [row.order, row.note];
    expect(filterRows(rows, "special", sparseFields)).toEqual([rows[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    const rows = makeRows(5);
    expect(filterRows(rows, "no-such-thing", fields)).toEqual([]);
  });

  it("skips null field values instead of coercing them to the literal text \"null\"", () => {
    type NullableRow = { order: string; confirmedReason?: string };
    const rows: NullableRow[] = [
      // The live API can hand back `confirmedReason: null` even though the
      // declared TS type says `string | undefined` (see OpsReturnRow /
      // isAwaitingReview in OpsQueuePage.tsx) -- the cast mirrors that real
      // mismatch without resorting to `any`.
      { order: "A", confirmedReason: null as unknown as string },
      { order: "B", confirmedReason: "null-shaped reason" }
    ];
    const sparseFields = (row: NullableRow) => [row.order, row.confirmedReason];
    expect(filterRows(rows, "null", sparseFields)).toEqual([rows[1]]);
  });
});

describe("paginate", () => {
  it("returns the first page", () => {
    const rows = makeRows(25);
    const page = paginate(rows, 1, 10);
    expect(page).toHaveLength(10);
    expect(page[0]).toEqual(rows[0]);
    expect(page[9]).toEqual(rows[9]);
  });

  it("returns a partial last page", () => {
    const rows = makeRows(25);
    const page = paginate(rows, 3, 10);
    expect(page).toHaveLength(5);
    expect(page[0]).toEqual(rows[20]);
    expect(page[4]).toEqual(rows[24]);
  });

  it("returns an empty array for a page beyond the end", () => {
    const rows = makeRows(25);
    expect(paginate(rows, 10, 10)).toEqual([]);
  });

  it("returns every row on page 1 when pageSize exceeds the row count", () => {
    const rows = makeRows(5);
    expect(paginate(rows, 1, 50)).toEqual(rows);
  });
});

describe("deriveTableState", () => {
  it("reports totals and a full first page when there is no query", () => {
    const rows = makeRows(25);
    const state = deriveTableState(rows, "", 1, 10, fields);
    expect(state.totalCount).toBe(25);
    expect(state.filteredCount).toBe(25);
    expect(state.pageCount).toBe(3);
    expect(state.visibleRows).toHaveLength(10);
    expect(state.rangeStart).toBe(1);
    expect(state.rangeEnd).toBe(10);
  });

  it("gives a query matching nothing filteredCount 0, pageCount 1, and a zeroed range", () => {
    const rows = makeRows(25);
    const state = deriveTableState(rows, "does-not-exist", 1, 10, fields);
    expect(state.filteredCount).toBe(0);
    expect(state.pageCount).toBe(1);
    expect(state.rangeStart).toBe(0);
    expect(state.rangeEnd).toBe(0);
    expect(state.visibleRows).toEqual([]);
    expect(state.totalCount).toBe(25);
  });

  it("clamps a page beyond the end back into range instead of returning a blank page", () => {
    const rows = makeRows(25);
    const state = deriveTableState(rows, "", 99, 10, fields);
    expect(state.page).toBe(3);
    expect(state.visibleRows).toHaveLength(5);
    expect(state.rangeStart).toBe(21);
    expect(state.rangeEnd).toBe(25);
  });

  it("clamps when rows shrink under the current page, e.g. after a filter or refetch", () => {
    const rows = makeRows(12);
    const state = deriveTableState(rows, "", 5, 10, fields);
    expect(state.page).toBe(2);
    expect(state.pageCount).toBe(2);
    expect(state.visibleRows).toHaveLength(2);
  });

  it("puts every row on page 1 when pageSize is larger than the row count", () => {
    const rows = makeRows(5);
    const state = deriveTableState(rows, "", 1, 50, fields);
    expect(state.pageCount).toBe(1);
    expect(state.visibleRows).toHaveLength(5);
    expect(state.rangeStart).toBe(1);
    expect(state.rangeEnd).toBe(5);
  });

  it("computes range arithmetic for a middle page: 68 rows, size 25, page 3 -> 51-68", () => {
    const rows = makeRows(68);
    const state = deriveTableState(rows, "", 3, 25, fields);
    expect(state.page).toBe(3);
    expect(state.pageCount).toBe(3);
    expect(state.visibleRows).toHaveLength(18);
    expect(state.rangeStart).toBe(51);
    expect(state.rangeEnd).toBe(68);
  });

  it("treats a whitespace-only query as no query at all", () => {
    const rows = makeRows(25);
    const state = deriveTableState(rows, "   ", 1, 10, fields);
    expect(state.filteredCount).toBe(25);
  });

  it("pageCount is at least 1 even when there are no rows", () => {
    const state = deriveTableState([], "", 1, 10, fields);
    expect(state.pageCount).toBe(1);
    expect(state.page).toBe(1);
    expect(state.rangeStart).toBe(0);
    expect(state.rangeEnd).toBe(0);
  });
});

// The page-reset rule is a distinct spec rule from deriveTableState's clamp:
// changing the query or the page size snaps back to page 1, even when the
// clamp alone would have left an in-range page untouched (e.g. narrowing to
// a same-or-larger page count than the current page). Re-applying the same
// query/pageSize value must NOT reset the page -- a re-render or an
// identical keystroke shouldn't yank the user back to page 1.
describe("nextTableState", () => {
  it("resets to page 1 when the query changes", () => {
    const state: TableState = { query: "a", page: 3, pageSize: 10 };
    expect(nextTableState(state, { query: "b" })).toEqual({ query: "b", page: 1, pageSize: 10 });
  });

  it("does not reset the page when the query is set to its current value", () => {
    const state: TableState = { query: "a", page: 3, pageSize: 10 };
    expect(nextTableState(state, { query: "a" })).toEqual({ query: "a", page: 3, pageSize: 10 });
  });

  it("resets to page 1 when the page size changes", () => {
    const state: TableState = { query: "a", page: 3, pageSize: 10 };
    expect(nextTableState(state, { pageSize: 25 })).toEqual({ query: "a", page: 1, pageSize: 25 });
  });

  it("does not reset the page when the page size is set to its current value", () => {
    const state: TableState = { query: "a", page: 3, pageSize: 10 };
    expect(nextTableState(state, { pageSize: 10 })).toEqual({ query: "a", page: 3, pageSize: 10 });
  });

  it("changes the page alone without touching query or pageSize", () => {
    const state: TableState = { query: "a", page: 2, pageSize: 10 };
    expect(nextTableState(state, { page: 5 })).toEqual({ query: "a", page: 5, pageSize: 10 });
  });

  it("lands a narrowing query on page 1 instead of clamping to the old page", () => {
    // The review's example: sitting on page 3 of a 5-page, 50-row set, then
    // typing a query that narrows the result to exactly a 3-page set. A bare
    // clamp (deriveTableState alone) would land on min(3, 3) = 3 -- the same
    // page as before, looking like nothing happened. The reset rule requires
    // page 1 instead.
    const rows = makeRows(50);
    const searchable = rows.map((row, index) => (index < 21 ? { ...row, product: `match-me ${row.product}` } : row));
    const narrowFields = (row: Row) => [row.order, row.product, row.amount];

    const state: TableState = { query: "", page: 3, pageSize: 10 };
    const next = nextTableState(state, { query: "match-me" });
    expect(next.page).toBe(1);

    const derived = deriveTableState(searchable, next.query, next.page, next.pageSize, narrowFields);
    expect(derived.filteredCount).toBe(21);
    expect(derived.pageCount).toBe(3);
    expect(derived.page).toBe(1);

    // Contrast: clamping the *old* page (3) against the same narrowed result
    // without going through the reset rule lands on page 3, not page 1 --
    // proving the reset is a separate rule from the clamp, not a consequence
    // of it.
    const clampedOnly = deriveTableState(searchable, "match-me", state.page, state.pageSize, narrowFields);
    expect(clampedOnly.page).toBe(3);
  });
});

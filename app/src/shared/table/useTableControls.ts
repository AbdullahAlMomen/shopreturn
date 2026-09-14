import { useMemo, useState } from "react";

// Shared search + pagination for every list surface in the app (My returns'
// DataTable, the ops queue's hand-rolled row markup). The pure functions
// below are exported and tested directly -- @testing-library/react is not a
// dependency (see package.json), so the hook itself is kept to a thin
// useState + useMemo shell over deriveTableState, which is the actual unit
// under test.

export type TableControls<T> = {
  query: string;
  setQuery: (next: string) => void;
  page: number;
  setPage: (next: number) => void;
  pageSize: number;
  setPageSize: (next: number) => void;
  visibleRows: T[];
  filteredCount: number;
  totalCount: number;
  pageCount: number;
  rangeStart: number;
  rangeEnd: number;
};

export type DerivedTableState<T> = {
  page: number;
  visibleRows: T[];
  filteredCount: number;
  totalCount: number;
  pageCount: number;
  rangeStart: number;
  rangeEnd: number;
};

// Case-insensitive substring match against the concatenated field values.
// `undefined` and `null` fields are skipped rather than coerced to the
// strings "undefined"/"null" -- some rows carry a real `null` even though
// the TS type only declares `undefined` (e.g. OpsReturnRow.confirmedReason,
// which useOpsQueue's own isAwaitingReview checks against `null`), so
// skipping only `undefined` would make the literal text "null" match every
// un-reviewed row. Numbers are matched via their string form so a SKU or a
// taka amount is searchable the same way an order number is. An empty or
// whitespace-only query is "show everything", not "match nothing".
export function filterRows<T>(rows: T[], query: string, fields: (row: T) => (string | number | undefined)[]): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    fields(row).some((value) => value !== undefined && value !== null && String(value).toLowerCase().includes(needle))
  );
}

// Rows for a 1-based page. Deliberately does not clamp `page` itself --
// callers that need "page beyond the end shows the last page instead of a
// blank one" (deriveTableState, and therefore useTableControls) clamp before
// calling this; a bare out-of-range page here just yields [].
export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

// The pure computation behind useTableControls: filter, clamp the requested
// page into range, slice, and derive the 1-based display range. Clamping
// happens here (not via a setState effect) so a shrinking row set -- a
// refetch, or typing a query while sitting on page 5 -- never renders a
// blank page even for one tick.
export function deriveTableState<T>(
  rows: T[],
  query: string,
  page: number,
  pageSize: number,
  fields: (row: T) => (string | number | undefined)[]
): DerivedTableState<T> {
  const filtered = filterRows(rows, query, fields);
  const totalCount = rows.length;
  const filteredCount = filtered.length;
  const pageCount = Math.max(1, Math.ceil(filteredCount / pageSize));
  const clampedPage = Math.min(Math.max(1, page), pageCount);
  const visibleRows = paginate(filtered, clampedPage, pageSize);
  const rangeStart = filteredCount === 0 ? 0 : (clampedPage - 1) * pageSize + 1;
  const rangeEnd = filteredCount === 0 ? 0 : rangeStart + visibleRows.length - 1;

  return { page: clampedPage, visibleRows, filteredCount, totalCount, pageCount, rangeStart, rangeEnd };
}

export type TableState = { query: string; page: number; pageSize: number };

// The page-reset rule, isolated as a pure function so it's unit-testable
// without rendering the hook (no @testing-library/react in this project --
// see the header comment). This is a distinct rule from deriveTableState's
// clamp: changing the query or the page size always snaps back to page 1,
// even in cases where the clamp alone would have left the current page
// in-range (e.g. narrowing from page 3 of a 5-page set to a same-or-larger
// page count). Setting a query/pageSize to the value it already has must
// NOT reset the page -- a re-render or an identical keystroke shouldn't yank
// the user back to page 1. Changing the page alone leaves query/pageSize
// untouched.
export function nextTableState(state: TableState, change: Partial<TableState>): TableState {
  const next = { ...state, ...change };
  if (change.query !== undefined && change.query !== state.query) next.page = 1;
  if (change.pageSize !== undefined && change.pageSize !== state.pageSize) next.page = 1;
  return next;
}

export function useTableControls<T>(
  rows: T[],
  fields: (row: T) => (string | number | undefined)[],
  initialPageSize?: number
): TableControls<T> {
  const [state, setState] = useState<TableState>({ query: "", page: 1, pageSize: initialPageSize ?? 10 });

  const derived = useMemo(
    () => deriveTableState(rows, state.query, state.page, state.pageSize, fields),
    [rows, state.query, state.page, state.pageSize, fields]
  );

  // All three setters route through nextTableState so the page-reset rule
  // lives in exactly one place (see above) rather than being duplicated, or
  // silently dropped, across setQuery/setPage/setPageSize.
  function setQuery(next: string) {
    setState((prev) => nextTableState(prev, { query: next }));
  }

  function setPage(next: number) {
    setState((prev) => nextTableState(prev, { page: next }));
  }

  function setPageSize(next: number) {
    setState((prev) => nextTableState(prev, { pageSize: next }));
  }

  return {
    query: state.query,
    setQuery,
    page: derived.page,
    setPage,
    pageSize: state.pageSize,
    setPageSize,
    visibleRows: derived.visibleRows,
    filteredCount: derived.filteredCount,
    totalCount: derived.totalCount,
    pageCount: derived.pageCount,
    rangeStart: derived.rangeStart,
    rangeEnd: derived.rangeEnd
  };
}

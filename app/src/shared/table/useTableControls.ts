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
// `undefined` fields are skipped rather than coerced to "undefined"; numbers
// are matched via their string form so a SKU or a taka amount is searchable
// the same way an order number is. An empty or whitespace-only query is
// "show everything", not "match nothing".
export function filterRows<T>(rows: T[], query: string, fields: (row: T) => (string | number | undefined)[]): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    fields(row).some((value) => value !== undefined && String(value).toLowerCase().includes(needle))
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

export function useTableControls<T>(
  rows: T[],
  fields: (row: T) => (string | number | undefined)[],
  initialPageSize?: number
): TableControls<T> {
  const [query, setQueryRaw] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(initialPageSize ?? 10);

  const derived = useMemo(
    () => deriveTableState(rows, query, page, pageSize, fields),
    [rows, query, page, pageSize, fields]
  );

  // Changing the query or the page size resets to page 1: filtering to 3
  // rows (or shrinking the page size) while sitting on page 5 would
  // otherwise show an empty table until deriveTableState's clamp catches up
  // on the next render.
  function setQuery(next: string) {
    setQueryRaw(next);
    setPage(1);
  }

  function setPageSize(next: number) {
    setPageSizeRaw(next);
    setPage(1);
  }

  return {
    query,
    setQuery,
    page: derived.page,
    setPage,
    pageSize,
    setPageSize,
    visibleRows: derived.visibleRows,
    filteredCount: derived.filteredCount,
    totalCount: derived.totalCount,
    pageCount: derived.pageCount,
    rangeStart: derived.rangeStart,
    rangeEnd: derived.rangeEnd
  };
}

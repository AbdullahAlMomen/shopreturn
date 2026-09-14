import type { ReactNode } from "react";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { useTableControls } from "../table/useTableControls";
import { TablePaginationFooter, TableSearchBox } from "./TableControls";

export type Column<T> = { key: string; header: ReactNode; render: (row: T) => ReactNode };

const NO_FIELDS = () => [];

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  // Optional: when provided, a search box renders above the table and rows
  // are filtered against these fields (see useTableControls' filterRows).
  searchFields?: (row: T) => (string | number | undefined)[];
  // Optional: when provided (or when searchFields is), the pagination
  // footer renders. Existing callers that pass neither keep today's
  // behaviour -- every row, no controls -- unchanged.
  pageSize?: number;
  searchPlaceholder?: string;
};

export function DataTable<T>({ columns, rows, searchFields, pageSize, searchPlaceholder }: DataTableProps<T>) {
  const { t } = useT();
  const showControls = Boolean(searchFields) || pageSize !== undefined;
  const controls = useTableControls(rows, searchFields ?? NO_FIELDS, pageSize);
  const displayRows = showControls ? controls.visibleRows : rows;

  return (
    <>
      {searchFields ? <TableSearchBox controls={controls} placeholder={searchPlaceholder} /> : null}
      <div className="table-shell">
        <table>
          <thead>
            <tr>{columns.map((column) => <th key={column.key}>{column.header}</th>)}</tr>
          </thead>
          <tbody>
            {showControls && controls.filteredCount === 0 ? (
              <tr>
                <td colSpan={columns.length}>{t("table.noMatches")}</td>
              </tr>
            ) : (
              displayRows.map((row, index) => (
                <tr key={String((row as Record<string, unknown>).itemId ?? (row as Record<string, unknown>).id ?? index)}>
                  {columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {showControls ? <TablePaginationFooter controls={controls} /> : null}
    </>
  );
}

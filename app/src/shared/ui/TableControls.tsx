import { Search } from "lucide-react";
import { useT } from "../../lib/i18n/LocalizationProvider";
import type { TableControls as TableControlsState } from "../table/useTableControls";

const PAGE_SIZES = [10, 25, 50];

// Shared search box + pagination footer markup for every list surface:
// DataTable (My returns) and the ops queue's hand-rolled rows both drive one
// of these off the same useTableControls state, so the controls only exist
// once. Two components, not one, because the search box sits above the
// list and the pagination footer sits below it -- callers place them
// wherever their own layout needs.

export function TableSearchBox<T>({ controls, placeholder }: { controls: TableControlsState<T>; placeholder?: string }) {
  const { t } = useT();
  return (
    <div className="toolbar">
      <label className="search-box">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={controls.query}
          onChange={(event) => controls.setQuery(event.target.value)}
          placeholder={placeholder ?? t("table.searchPlaceholder")}
          aria-label={t("table.search")}
        />
      </label>
    </div>
  );
}

export function TablePaginationFooter<T>({ controls }: { controls: TableControlsState<T> }) {
  const { t } = useT();
  const { query, page, setPage, pageSize, setPageSize, filteredCount, totalCount, pageCount, rangeStart, rangeEnd } = controls;

  const showingText = query.trim()
    ? t("table.showingFiltered")
        .replace("{start}", String(rangeStart))
        .replace("{end}", String(rangeEnd))
        .replace("{total}", String(filteredCount))
        .replace("{all}", String(totalCount))
    : t("table.showing")
        .replace("{start}", String(rangeStart))
        .replace("{end}", String(rangeEnd))
        .replace("{total}", String(totalCount));

  return (
    <div className="pagination">
      <span className="pagination-count">{showingText}</span>
      <div className="pagination-controls">
        <label className="pagination-size">
          {t("table.perPage")}
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button type="button" className="icon-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          {t("table.previous")}
        </button>
        <span aria-live="polite">{t("table.page").replace("{page}", String(page)).replace("{pages}", String(pageCount))}</span>
        <button type="button" className="icon-button" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
          {t("table.next")}
        </button>
      </div>
    </div>
  );
}

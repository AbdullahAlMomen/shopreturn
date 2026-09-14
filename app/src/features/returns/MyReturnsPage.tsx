import { PackageOpen, RefreshCw } from "lucide-react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { DataTable } from "../../shared/ui/DataTable";
import type { Column } from "../../shared/ui/DataTable";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ErrorState } from "../../shared/ui/ErrorState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Skeleton } from "../../shared/ui/Skeleton";
import { StatusPill } from "../../shared/ui/StatusPill";
import { useT } from "../../lib/i18n/LocalizationProvider";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useMyReturns } from "./useMyReturns";
import type { ReturnRow } from "./useMyReturns";

// The hand-rolled router (src/app/router/routes.tsx) doesn't thread
// `navigate` down into page components -- only AppShell gets it, for the
// sidebar. This mirrors exactly what that router's own `navigate()` does
// (pushState + update) so a click here lands on the same history entry a
// "real" navigate() call would produce; Task 2's detail page reads the
// `id` query param off `location.search` the same way the router already
// reads `path`/`search`.
function goToReturn(itemId: string) {
  window.history.pushState({}, "", `/returns?id=${encodeURIComponent(itemId)}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// Hoisted to a stable module-level reference (same pattern as
// OpsQueuePage.tsx's opsSearchFields) -- an inline arrow passed as a prop is
// a new function identity every render, which would defeat the useMemo
// inside useTableControls and re-filter on every keystroke's re-render for
// no reason.
function returnsSearchFields(row: ReturnRow): (string | number | undefined)[] {
  return [row.orderNumber, row.productName, row.status];
}

function statusTone(status?: string): "good" | "warn" | "neutral" {
  if (status === "REFUNDED") return "good";
  if (status === "REJECTED") return "warn";
  return "neutral";
}

function formatAge(row: ReturnRow, t: (key: TranslationKey, fallback?: string) => string): string {
  const created = row.CreatedDate ? new Date(row.CreatedDate) : undefined;
  if (!created || Number.isNaN(created.getTime())) return t("returns.age.unknown");

  const days = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000));
  if (days === 0) return t("returns.age.today");
  return `${days} ${t("returns.age.daysUnit")}`;
}

export function MyReturnsPage() {
  const { returns, loading, error, refetch } = useMyReturns();
  const { t } = useT();

  const columns: Column<ReturnRow>[] = [
    {
      header: t("returns.columns.order"),
      key: "orderNumber",
      render: (row) => (
        <a
          className="link-button mono"
          href={`/returns?id=${encodeURIComponent(row.ItemId)}`}
          onClick={(event) => {
            event.preventDefault();
            goToReturn(row.ItemId);
          }}
        >
          {row.orderNumber || t("returns.unknownOrder")}
        </a>
      )
    },
    {
      header: t("returns.columns.product"),
      key: "productName",
      render: (row) => row.productName || t("returns.unknownProduct")
    },
    {
      header: t("returns.columns.status"),
      key: "status",
      render: (row) => <StatusPill tone={statusTone(row.status)}>{row.status || t("returns.status.unknown")}</StatusPill>
    },
    {
      header: t("returns.columns.age"),
      key: "age",
      render: (row) => <span className="mono">{formatAge(row, t)}</span>
    }
  ];

  return (
    <section>
      <PageHeader
        title={t("returns.title")}
        subtitle={t("returns.subtitle")}
        actions={<ActionButton variant="icon" onClick={() => refetch()} title={t("common.refresh")} icon={<RefreshCw size={18} />} />}
      />

      {loading ? (
        <div className="panel">
          <Skeleton className="skeleton-line" style={{ width: "100%" }} />
          <Skeleton className="skeleton-line" style={{ width: "90%" }} />
          <Skeleton className="skeleton-line" style={{ width: "95%" }} />
        </div>
      ) : error ? (
        <ErrorState message={t("returns.loadError")} onRetry={refetch} />
      ) : returns.length === 0 ? (
        <EmptyState
          icon={<PackageOpen size={28} />}
          title={t("returns.empty.title")}
          description={t("returns.empty.description")}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={returns}
          searchFields={returnsSearchFields}
          pageSize={10}
        />
      )}
    </section>
  );
}

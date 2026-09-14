import { ClipboardList, RefreshCw } from "lucide-react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ErrorState } from "../../shared/ui/ErrorState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useT } from "../../lib/i18n/LocalizationProvider";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useRoles } from "../../lib/blocks/useRoles";
import { useOpsQueue } from "./useOpsQueue";
import type { OpsReturnRow } from "./useOpsQueue";

// Same pushState + synthetic popstate pattern as NewReturnPage's
// goToReturn() -- the hand-rolled router only matches pathname, so this
// lands on the same history entry a "real" navigate() call would produce.
// Added alongside Task 2's review screen: a queue nobody can click into
// isn't a queue, it's a list.
function goToReview(itemId: string) {
  window.history.pushState({}, "", `/ops/review?id=${encodeURIComponent(itemId)}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// Same age formatting as MyReturnsPage.tsx (returns.age.* keys are shared,
// not duplicated) -- not imported from there because that function isn't
// exported, and this hook's row shape differs (OpsReturnRow vs ReturnRow).
function formatAge(row: OpsReturnRow, t: (key: TranslationKey, fallback?: string) => string): string {
  const created = row.CreatedDate ? new Date(row.CreatedDate) : undefined;
  if (!created || Number.isNaN(created.getTime())) return t("returns.age.unknown");

  const days = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000));
  if (days === 0) return t("returns.age.today");
  return `${days} ${t("returns.age.daysUnit")}`;
}

// A row's `confirmedReason` is null until a human on ops has actually made a
// call on it -- that absence, not `status`, is what "awaiting review" means
// here. This is the queue's whole reason for existing, so it drives both the
// row highlight and the review-column badge.
function isAwaitingReview(row: OpsReturnRow): boolean {
  return row.confirmedReason === null || row.confirmedReason === undefined;
}

export function OpsQueuePage() {
  const { t } = useT();
  const { hasRole, isLoading: rolesLoading, roles } = useRoles();
  const { returns, loading, error, refetch } = useOpsQueue();

  // UX-only guard, same shape as NewReturnPage's customer-only gate: the
  // sidebar already hides this route for non-ops (see navItems.ts), but
  // anyone can still type the URL directly. This just names the role
  // clearly instead of showing a blank page or an opaque server error --
  // it enforces nothing itself, the grant matrix in blocks/data/rules.json
  // remains the actual boundary.
  // Roles come from iam.me(), so they are unknown for the first paint or
  // two. Denying in that window would flash "not for your role" at a real
  // ops user before their own queue appeared.
  if (rolesLoading) {
    return (
      <section>
        <PageHeader title={t("ops.title")} subtitle={t("ops.subtitle")} />
        <div className="panel">
          <Skeleton className="skeleton-line" style={{ width: "100%" }} />
          <Skeleton className="skeleton-line" style={{ width: "90%" }} />
        </div>
      </section>
    );
  }

  if (!hasRole("ops")) {
    const roleLabel = roles.length > 0 ? roles.join(", ") : t("ops.restricted.genericRole");
    return (
      <section>
        <EmptyState
          title={t("ops.restricted.title")}
          description={t("ops.restricted.description").replace("{role}", roleLabel)}
        />
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title={t("ops.title")}
        subtitle={t("ops.subtitle")}
        actions={<ActionButton variant="icon" onClick={() => refetch()} title={t("common.refresh")} icon={<RefreshCw size={18} />} />}
      />

      {loading ? (
        <div className="panel">
          <Skeleton className="skeleton-line" style={{ width: "100%" }} />
          <Skeleton className="skeleton-line" style={{ width: "90%" }} />
          <Skeleton className="skeleton-line" style={{ width: "95%" }} />
        </div>
      ) : error ? (
        <ErrorState message={t("ops.loadError")} onRetry={refetch} />
      ) : returns.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={28} />}
          title={t("ops.empty.title")}
          description={t("ops.empty.description")}
        />
      ) : (
        <div className="ops-queue">
          <div className="ops-queue-head">
            <span>{t("returns.columns.order")}</span>
            <span>{t("returns.columns.product")}</span>
            <span>{t("ops.columns.customerSaid")}</span>
            <span>{t("ops.columns.aiProposal")}</span>
            <span>{t("returns.columns.status")}</span>
            <span>{t("returns.columns.age")}</span>
            <span>{t("ops.columns.review")}</span>
          </div>
          {returns.map((row) => {
            const pending = isAwaitingReview(row);
            return (
              <div
                key={row.ItemId}
                className={`ops-queue-row${pending ? " ops-queue-row-pending" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => goToReview(row.ItemId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    goToReview(row.ItemId);
                  }
                }}
              >
                <span className="ops-queue-order">{row.orderNumber || t("returns.unknownOrder")}</span>
                <span className="ops-queue-product">{row.productName || t("returns.unknownProduct")}</span>
                <span className="ops-queue-quote" title={row.rawCustomerText}>{row.rawCustomerText || "—"}</span>
                {row.aiReason ? (
                  <span className="ops-queue-ai">
                    <span className="ops-queue-ai-reason">{row.aiReason}</span>
                    <span className="ops-queue-ai-confidence">
                      {typeof row.aiConfidence === "number" ? `${Math.round(row.aiConfidence * 100)}%` : "—"}
                    </span>
                  </span>
                ) : (
                  <span className="ops-queue-ai-empty">{t("ops.ai.none")}</span>
                )}
                <span className="ops-queue-status">{row.status || t("returns.status.unknown")}</span>
                <span className="ops-queue-age">{formatAge(row, t)}</span>
                <span className={`ops-queue-review ${pending ? "ops-queue-review-pending" : "ops-queue-review-done"}`}>
                  {pending ? t("ops.review.pending") : t("ops.review.done")}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

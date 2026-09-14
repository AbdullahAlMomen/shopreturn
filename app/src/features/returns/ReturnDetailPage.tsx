import { ArrowLeft } from "lucide-react";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ErrorState } from "../../shared/ui/ErrorState";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { timelineTimestamp, useReturnDetail } from "./useReturnDetail";
import type { TimelineEntry } from "./useReturnDetail";

// The hand-rolled router (src/app/router/routes.tsx) renders every
// protectedRoutes entry as <Page /> with no props, so this page reads its
// own `id` query param off location.search rather than receiving it -- the
// same reason MyReturnsPage's goToReturn() drives navigation with
// pushState + a synthetic popstate instead of a real navigate() call.
function currentReturnId(): string | undefined {
  return new URLSearchParams(window.location.search).get("id") ?? undefined;
}

function goToMyReturns() {
  window.history.pushState({}, "", "/returns");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function statusTone(status?: string): "good" | "warn" | "neutral" {
  if (status === "REFUNDED") return "good";
  if (status === "REJECTED") return "warn";
  return "neutral";
}

function formatWhen(iso?: string): { date: string; time: string } {
  if (!iso) return { date: "—", time: "" };
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return { date: "—", time: "" };
  return {
    date: parsed.toLocaleDateString("en-US", { month: "short", day: "2-digit" }).toUpperCase(),
    time: parsed.toLocaleTimeString("en-US", { hour: "2-digit", hour12: false, minute: "2-digit" })
  };
}

function isTerminalEntry(entry: TimelineEntry, index: number, total: number): boolean {
  return index === total - 1 && (entry.status === "REFUNDED" || entry.status === "REJECTED");
}

export function ReturnDetailPage() {
  const itemId = currentReturnId();
  const { error, loading, refund, returnCase, timeline } = useReturnDetail(itemId);
  const { t } = useT();

  return (
    <section>
      <a
        className="ledger-back"
        href="/returns"
        onClick={(event) => {
          event.preventDefault();
          goToMyReturns();
        }}
      >
        <ArrowLeft size={14} /> {t("returns.detail.back")}
      </a>

      {loading ? (
        <div className="panel">
          <Skeleton className="skeleton-line-lg" style={{ width: "60%" }} />
          <Skeleton className="skeleton-line" style={{ width: "100%" }} />
          <Skeleton className="skeleton-line" style={{ width: "90%" }} />
        </div>
      ) : error ? (
        <ErrorState message={t("returns.detail.loadError")} />
      ) : !returnCase ? (
        <EmptyState title={t("returns.detail.notFound.title")} description={t("returns.detail.notFound.description")} />
      ) : (
        <div className="ledger-page">
          <header className="ledger-header">
            <h1 className="ledger-order">
              {t("returns.detail.orderPrefix")}
              {returnCase.orderNumber || t("returns.unknownOrder")}
            </h1>
            <span className={`ledger-status ledger-status-${statusTone(returnCase.status)}`}>
              {returnCase.status || t("returns.status.unknown")}
            </span>
          </header>

          {returnCase.rawCustomerText ? (
            <blockquote className="ledger-quote">{returnCase.rawCustomerText}</blockquote>
          ) : null}

          <div className="ledger-label">{t("returns.detail.recordLabel")}</div>

          {timeline.length === 0 ? (
            <p className="muted">{t("returns.detail.empty")}</p>
          ) : (
            <div className="ledger-rows">
              {timeline.map((entry, index) => {
                const terminal = isTerminalEntry(entry, index, timeline.length);
                const { date, time } = formatWhen(timelineTimestamp(entry));
                return (
                  <div
                    key={entry.ItemId}
                    className={`ledger-row${terminal ? " ledger-row-terminal" : ""}`}
                    // isCustomerVisible is requested (never used to filter -- the
                    // server policy already scopes what this list can return) so
                    // it's at least visible in the DOM that it was considered.
                    data-customer-visible={String(entry.isCustomerVisible ?? true)}
                  >
                    <div className="ledger-when">
                      <div>{date}</div>
                      <div>{time}</div>
                    </div>
                    <div className="ledger-message">
                      <p>{entry.message}</p>
                      {terminal && entry.status === "REFUNDED" && refund ? (
                        <div className="ledger-refund">
                          <span className="ledger-amount">৳{refund.amount?.toLocaleString("en-US")}</span>
                          <span className="ledger-reference">{refund.method} &middot; {refund.reference}</span>
                        </div>
                      ) : null}
                      {terminal && entry.status === "REJECTED" && returnCase.rejectionReason ? (
                        <p className="ledger-rejection">{returnCase.rejectionReason}</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

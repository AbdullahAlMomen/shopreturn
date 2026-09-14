import { RefreshCw } from "lucide-react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ErrorState } from "../../shared/ui/ErrorState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useT } from "../../lib/i18n/LocalizationProvider";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useRoles } from "../../lib/blocks/useRoles";
import { formatPercent, formatTaka } from "./analytics";
import type { Insights } from "./analytics";
import { FacetBars } from "./FacetBars";
import { useInsights } from "./useInsights";
import { AlertStrip } from "./AlertStrip";
import { DecisionLog } from "./DecisionLog";
import { useAlerts } from "./useAlerts";

// Reason labels already exist for the ops review screen; reuse them so a
// reason reads identically wherever it appears.
export function useReasonLabel() {
  const { t } = useT();
  return (reason: string) =>
    reason === "UNCATEGORISED"
      ? t("insights.reason.uncategorised")
      : t(`ops.review.reason.${reason}` as TranslationKey, reason);
}

function Answer({ insights }: { insights: Insights }) {
  const { t } = useT();
  const reasonLabel = useReasonLabel();

  if (insights.totals.returns === 0) {
    return <p className="insights-answer insights-answer-lead">{t("insights.headline.none")}</p>;
  }

  const lead = t("insights.headline.lead")
    .replace("{rate}", formatPercent(insights.totals.rate))
    .replace("{taka}", formatTaka(insights.totals.takaImpact));

  const worst = insights.worst;
  let worstSentence = "";
  if (worst) {
    const template = worst.pairCount > 0 ? t("insights.headline.worst") : t("insights.headline.worstNoPlace");
    worstSentence = template
      .replace("{product}", `${worst.product.label} (${worst.product.key})`)
      .replace("{taka}", formatTaka(worst.product.takaImpact))
      .replace("{pairCount}", String(worst.pairCount))
      .replace("{returns}", String(worst.product.returns))
      .replace("{area}", worst.area)
      .replace("{courier}", worst.courier)
      .replace("{reason}", reasonLabel(worst.reason));
  }

  return (
    <div className="insights-answer">
      <p className="insights-answer-lead">{lead}</p>
      {worstSentence ? <p className="insights-answer-worst">{worstSentence}</p> : null}
    </div>
  );
}

// Hooks live here, below the role gate, so a non-manager who types the URL
// never triggers the manager's data fetch at all.
function Dashboard() {
  const { t } = useT();
  const reasonLabel = useReasonLabel();
  const { insights, loading, error, refetch } = useInsights();
  const alertState = useAlerts();

  return (
    <section className="insights-page">
      <PageHeader
        title={t("insights.title")}
        subtitle={t("insights.subtitle")}
        actions={
          <ActionButton
            variant="icon"
            onClick={() => { void refetch(); void alertState.refetch(); }}
            title={t("common.refresh")}
            icon={<RefreshCw size={18} />}
          />
        }
      />

      {/* Docked above the answer, per the spec: the alert is what arrived
          before the manager did. Independent of the insights fetch, so a slow
          aggregation never hides an alert. */}
      <AlertStrip
        alerts={alertState.alerts}
        loading={alertState.loading}
        error={alertState.error}
        onAcknowledge={alertState.acknowledge}
        onRetry={() => void alertState.refetch()}
      />

      {loading ? (
        <div className="panel">
          <Skeleton className="skeleton-line" style={{ width: "100%" }} />
          <Skeleton className="skeleton-line" style={{ width: "80%" }} />
          <Skeleton className="skeleton-line" style={{ width: "90%" }} />
        </div>
      ) : error ? (
        <ErrorState message={t("insights.loadError")} onRetry={() => refetch()} />
      ) : insights ? (
        <>
          <Answer insights={insights} />
          <div className="insights-facets">
            <FacetBars title={t("insights.facet.product")} facets={insights.byProduct} showRate />
            <FacetBars title={t("insights.facet.area")} facets={insights.byArea} showRate />
            <FacetBars title={t("insights.facet.courier")} facets={insights.byCourier} showRate />
            <FacetBars
              title={t("insights.facet.reason")}
              facets={insights.byReason}
              showRate={false}
              labelFor={(facet) => reasonLabel(facet.key)}
            />
          </div>
        </>
      ) : null}

      <DecisionLog alerts={alertState.alerts} />
    </section>
  );
}

export function InsightsPage() {
  const { t } = useT();
  const { hasRole, isLoading: rolesLoading, roles } = useRoles();

  // Roles load from iam.me(); denying before they arrive would flash the
  // restricted notice at the manager. UX only -- rules.json is the boundary.
  if (rolesLoading) {
    return (
      <section>
        <div className="panel">
          <Skeleton className="skeleton-line" style={{ width: "100%" }} />
          <Skeleton className="skeleton-line" style={{ width: "90%" }} />
        </div>
      </section>
    );
  }

  if (!hasRole("manager")) {
    const roleLabel = roles.length > 0 ? roles.join(", ") : t("insights.restricted.genericRole");
    return (
      <section>
        <EmptyState
          title={t("insights.restricted.title")}
          description={t("insights.restricted.description").replace("{role}", roleLabel)}
        />
      </section>
    );
  }

  return <Dashboard />;
}

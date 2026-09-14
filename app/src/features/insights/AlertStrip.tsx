import { useState } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { ErrorState } from "../../shared/ui/ErrorState";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { formatTaka } from "./analytics";
import type { AlertRow } from "./useAlerts";

export function AlertStrip({
  alerts,
  loading,
  error,
  onAcknowledge,
  onRetry
}: {
  alerts: AlertRow[];
  loading: boolean;
  error?: string;
  onAcknowledge: (itemId: string) => Promise<boolean>;
  onRetry: () => void;
}) {
  const { t } = useT();
  const [busyId, setBusyId] = useState<string>();
  const [failedId, setFailedId] = useState<string>();

  // Skeleton only while loading with no data yet -- a refetch after an
  // acknowledge or a page refresh must not blank out the strip the manager
  // is already looking at.
  if (error) {
    return <div className="alert-strip"><ErrorState message={t("insights.alerts.loadError")} onRetry={onRetry} /></div>;
  }
  if (loading && alerts.length === 0) {
    return <div className="alert-strip"><Skeleton className="skeleton-line" style={{ width: "100%" }} /></div>;
  }
  if (alerts.length === 0) {
    return <p className="alert-strip-empty">{t("insights.alerts.empty")}</p>;
  }

  async function acknowledge(itemId: string) {
    setBusyId(itemId);
    setFailedId(undefined);
    const ok = await onAcknowledge(itemId);
    if (!ok) setFailedId(itemId);
    setBusyId(undefined);
  }

  return (
    <section className="alert-strip" aria-label={t("insights.alerts.title")}>
      {alerts.map((alert) => {
        const acknowledged = Boolean(alert.acknowledgedBy);
        return (
          <article key={alert.ItemId} className={acknowledged ? "alert-card alert-card-quiet" : "alert-card"}>
            <p className="alert-sentence">
              {t("insights.alerts.sentence")
                .replace("{value}", alert.value ?? "")
                .replace("{metric}", String(alert.metric ?? 0))
                .replace("{threshold}", String(alert.threshold ?? 0))
                .replace("{taka}", formatTaka(alert.takaImpact ?? 0))}
            </p>
            {alert.draftExplanation ? (
              <div>
                <span className="alert-draft-label">{t("insights.alerts.draftLabel")}</span>
                <p className="alert-draft">{alert.draftExplanation}</p>
              </div>
            ) : null}
            <div className="alert-actions">
              <span className="alert-meta">
                {alert.raisedAt ? t("insights.alerts.raisedAt").replace("{when}", new Date(alert.raisedAt).toLocaleString()) : ""}
              </span>
              {acknowledged ? (
                <span className="alert-meta">{t("insights.alerts.acknowledgedBy").replace("{who}", alert.acknowledgedBy ?? "")}</span>
              ) : (
                <ActionButton onClick={() => void acknowledge(alert.ItemId)} disabled={busyId === alert.ItemId}>
                  {t("insights.alerts.acknowledge")}
                </ActionButton>
              )}
            </div>
            {failedId === alert.ItemId ? (
              <p className="form-error" role="alert">{t("insights.alerts.acknowledgeError")}</p>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

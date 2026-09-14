import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { ErrorState } from "../../shared/ui/ErrorState";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useT } from "../../lib/i18n/LocalizationProvider";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import type { AlertRow } from "./useAlerts";
import type { DecisionRow, DecisionType } from "./useDecisions";

const TYPES: DecisionType[] = ["SIZE_CHART_FIX", "COURIER_CLAIM", "COD_PAUSE", "OTHER"];

export function DecisionLog({
  alerts,
  decisions,
  loading,
  error,
  record,
  complete,
  onRetry
}: {
  alerts: AlertRow[];
  decisions: DecisionRow[];
  loading: boolean;
  error?: string;
  record: (input: { alertId: string; decisionType: DecisionType; target: string; note: string }) => Promise<boolean>;
  complete: (itemId: string) => Promise<boolean>;
  onRetry: () => void;
}) {
  const { t } = useT();
  const [alertId, setAlertId] = useState("");
  const [decisionType, setDecisionType] = useState<DecisionType>("SIZE_CHART_FIX");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [completeFailedId, setCompleteFailedId] = useState<string>();

  // Default to the newest alert once alerts arrive, and prefill the target
  // with what that alert is about -- a decision is usually about the thing
  // the alert names.
  useEffect(() => {
    const first = alerts[0];
    if (!alertId && first) {
      setAlertId(first.ItemId);
      setTarget(first.value ?? "");
    }
  }, [alerts, alertId]);

  function chooseAlert(nextId: string) {
    setAlertId(nextId);
    setTarget(alerts.find((alert) => alert.ItemId === nextId)?.value ?? "");
  }

  const canSubmit = Boolean(alertId && target.trim() && note.trim()) && !saving;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setSaveFailed(false);
    const ok = await record({ alertId, decisionType, target: target.trim(), note: note.trim() });
    setSaving(false);
    if (ok) setNote("");
    else setSaveFailed(true);
  }

  async function markDone(itemId: string) {
    setCompleteFailedId(undefined);
    const ok = await complete(itemId);
    if (!ok) setCompleteFailedId(itemId);
  }

  const typeLabel = (type?: string) => t(`insights.decisions.type.${type ?? "OTHER"}` as TranslationKey, type);
  const statusLabel = (status?: string) => t(`insights.decisions.status.${status ?? "OPEN"}` as TranslationKey, status);

  return (
    <section className="decision-log">
      <h2 className="decision-log-title">{t("insights.decisions.title")}</h2>

      <form className="decision-form" onSubmit={(event) => void submit(event)}>
        <label>
          {t("insights.decisions.alert")}
          <select value={alertId} onChange={(event) => chooseAlert(event.target.value)} disabled={alerts.length === 0}>
            {alerts.map((alert) => (
              <option key={alert.ItemId} value={alert.ItemId}>{`${alert.dimension ?? ""} ${alert.value ?? ""}`.trim()}</option>
            ))}
          </select>
        </label>
        <label>
          {t("insights.decisions.type")}
          <select value={decisionType} onChange={(event) => setDecisionType(event.target.value as DecisionType)}>
            {TYPES.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
          </select>
        </label>
        <label>
          {t("insights.decisions.target")}
          <input value={target} onChange={(event) => setTarget(event.target.value)} />
        </label>
        <label className="decision-form-wide">
          {t("insights.decisions.note")}
          <textarea rows={3} value={note} placeholder={t("insights.decisions.notePlaceholder")} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="decision-form-wide">
          <ActionButton type="submit" disabled={!canSubmit}>{t("insights.decisions.record")}</ActionButton>
          {saveFailed ? <p className="ledger-rejection" role="alert">{t("insights.decisions.saveError")}</p> : null}
        </div>
      </form>

      {/* Skeleton only while loading with no data yet -- see AlertStrip for
          why: a refetch after recording or completing a decision must not
          blank the log the manager is already reading. */}
      {error ? (
        <ErrorState message={t("insights.decisions.loadError")} onRetry={onRetry} />
      ) : loading && decisions.length === 0 ? (
        <Skeleton className="skeleton-line" style={{ width: "100%" }} />
      ) : decisions.length === 0 ? (
        <p className="alert-strip-empty">{t("insights.decisions.empty")}</p>
      ) : (
        <div className="decision-rows">
          {decisions.map((decision) => (
            <div key={decision.ItemId} className="decision-row">
              <span className="decision-type">{typeLabel(decision.decisionType)} · {decision.target}</span>
              <span className={`decision-type decision-status-${decision.status ?? "OPEN"}`}>{statusLabel(decision.status)}</span>
              <p className="decision-note">{decision.note}</p>
              <span className="decision-meta">
                {[decision.decidedBy, decision.decidedAt ? new Date(decision.decidedAt).toLocaleString() : ""].filter(Boolean).join(" · ")}
              </span>
              {decision.status !== "DONE" ? (
                <ActionButton onClick={() => void markDone(decision.ItemId)}>{t("insights.decisions.markDone")}</ActionButton>
              ) : <span />}
              {completeFailedId === decision.ItemId ? (
                <p className="ledger-rejection decision-note" role="alert">{t("insights.decisions.completeError")}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

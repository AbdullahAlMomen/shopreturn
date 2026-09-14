import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ErrorState } from "../../shared/ui/ErrorState";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useT } from "../../lib/i18n/LocalizationProvider";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useRoles } from "../../lib/blocks/useRoles";
import { useReviewReturn } from "./useReviewReturn";
import type { ReviewReturnCase } from "./useReviewReturn";

// Same query-param + pushState/popstate pattern as ReturnDetailPage.tsx --
// the hand-rolled router has no path params, and this page needs the id to
// stay a real, bookmarkable URL (/ops/review?id=...) rather than component
// state.
function currentReviewId(): string | undefined {
  return new URLSearchParams(window.location.search).get("id") ?? undefined;
}

function goToQueue() {
  window.history.pushState({}, "", "/ops");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// Reason values are stored/sent exactly as-is; only the label shown to ops
// goes through i18n. Order matches the brief's canonical list.
const REASONS = [
  "DAMAGED_IN_TRANSIT", "WRONG_SIZE", "DEFECTIVE", "COD_REFUSAL", "CHANGED_MIND", "LATE_DELIVERY", "OTHER"
] as const;

type Translate = (key: TranslationKey, fallback?: string) => string;

function reasonLabel(reason: string, t: Translate): string {
  const key = `ops.review.reason.${reason}` as TranslationKey;
  return t(key, reason);
}

function formatConfidence(value?: number): string | undefined {
  if (typeof value !== "number") return undefined;
  return `${Math.round(value * 100)}%`;
}

export function OpsReviewPage() {
  const { t } = useT();
  const { hasRole, roles } = useRoles();
  const itemId = currentReviewId();
  const { returnCase, loading, loadError, accept, reject, retryNotify, submitting, submitStage, pendingNotify } =
    useReviewReturn(itemId);

  // Ops' working edits to the AI's reading. Seeded from the ai* columns
  // once the row loads -- see the sync effect below -- and never from the
  // confirmed* columns, which don't exist yet on a case awaiting review.
  const [reason, setReason] = useState<string>("");
  const [restockable, setRestockable] = useState(true);
  const [courierClaim, setCourierClaim] = useState(false);
  const [message, setMessage] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionValidationError, setRejectionValidationError] = useState<string>();

  // Seed the editable sentence and message draft from the AI proposal the
  // moment the row arrives. A ref-less "has this loaded" guard isn't needed
  // because `returnCase` only transitions from undefined to defined once
  // per itemId (useReviewReturn re-fetches, it doesn't merge).
  useEffect(() => {
    if (!returnCase) return;
    setReason(returnCase.aiReason ?? REASONS[0]);
    setRestockable(returnCase.aiRestockable ?? true);
    setCourierClaim(returnCase.aiCourierClaim ?? false);
    setMessage(returnCase.aiDraftMessage ?? "");
  }, [returnCase]);

  function correctedFields(returnCaseValue: ReviewReturnCase): string[] {
    const corrected: string[] = [];
    if (reason !== (returnCaseValue.aiReason ?? "")) corrected.push("reason");
    if (restockable !== (returnCaseValue.aiRestockable ?? true)) corrected.push("restockable");
    if (courierClaim !== (returnCaseValue.aiCourierClaim ?? false)) corrected.push("courierClaim");
    return corrected;
  }

  async function onAccept(event: FormEvent) {
    event.preventDefault();
    if (!returnCase) return;
    await accept({
      confirmedReason: reason,
      restockable,
      courierClaim,
      opsCorrectedFields: correctedFields(returnCase),
      message
    });
  }

  async function onReject(event: FormEvent) {
    event.preventDefault();
    const trimmed = rejectionReason.trim();
    // UI-level rule only -- blocks/data/rules.json does not require
    // rejectionReason to be non-empty on ReturnCase, so a hand-crafted API
    // call could still submit REJECTED with no reason. This screen refuses
    // to, because the spec requires the customer to be told why.
    if (!trimmed) {
      setRejectionValidationError(t("ops.review.rejectReasonValidation"));
      return;
    }
    setRejectionValidationError(undefined);
    await reject({ rejectionReason: trimmed });
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
      <a
        className="ledger-back"
        href="/ops"
        onClick={(event) => {
          event.preventDefault();
          goToQueue();
        }}
      >
        <ArrowLeft size={14} /> {t("ops.review.back")}
      </a>

      {loading ? (
        <div className="panel">
          <Skeleton className="skeleton-line-lg" style={{ width: "60%" }} />
          <Skeleton className="skeleton-line" style={{ width: "100%" }} />
          <Skeleton className="skeleton-line" style={{ width: "90%" }} />
        </div>
      ) : loadError ? (
        <ErrorState message={t("ops.review.loadError")} />
      ) : !returnCase ? (
        <EmptyState title={t("ops.review.notFound.title")} description={t("ops.review.notFound.description")} />
      ) : (
        <div className="ledger-page">
          <header className="ledger-header">
            <h1 className="ledger-order">
              {t("returns.detail.orderPrefix")}
              {returnCase.orderNumber || t("returns.unknownOrder")}
            </h1>
            <span className="ledger-status ledger-status-neutral">{returnCase.status || t("returns.status.unknown")}</span>
          </header>

          {returnCase.rawCustomerText ? (
            <blockquote className="ledger-quote">{returnCase.rawCustomerText}</blockquote>
          ) : null}

          {pendingNotify ? (
            <div className="ledger-notify-banner">
              <p className="ledger-notify-banner-title">{t("ops.review.notifyFailed.title")}</p>
              <p>
                {pendingNotify.status === "ACCEPTED"
                  ? t("ops.review.notifyFailed.acceptedBody")
                  : t("ops.review.notifyFailed.rejectedBody")}
              </p>
              <button type="button" className="ledger-submit ledger-submit-warn" onClick={() => void retryNotify()} disabled={submitting}>
                {submitting ? t("ops.review.notifyFailed.retrying") : t("ops.review.notifyFailed.retry")}
              </button>
            </div>
          ) : returnCase.status === "ACCEPTED" || returnCase.status === "REJECTED" ? (
            <div className="ledger-reviewed-summary">
              <p className="ledger-label">{t("ops.review.reviewed.title")}</p>
              <p>
                {returnCase.status === "ACCEPTED"
                  ? t("ops.review.reviewed.acceptedBody").replace("{reason}", reasonLabel(returnCase.confirmedReason ?? "", t))
                  : t("ops.review.reviewed.rejectedBody").replace("{reason}", returnCase.rejectionReason ?? "")}
              </p>
            </div>
          ) : (
            <>
              <p className="ledger-sentence">
                {t("ops.review.sentence.prefix")}{" "}
                <span className="ledger-select-wrap">
                  <select
                    className="ledger-inline-select"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={submitting || rejecting}
                  >
                    {REASONS.map((option) => (
                      <option key={option} value={option}>{reasonLabel(option, t)}</option>
                    ))}
                  </select>
                </span>{" "}
                {t("ops.review.sentence.itemIs")}{" "}
                <span className="ledger-select-wrap">
                  <select
                    className="ledger-inline-select"
                    value={restockable ? "yes" : "no"}
                    onChange={(event) => setRestockable(event.target.value === "yes")}
                    disabled={submitting || rejecting}
                  >
                    <option value="yes">{t("ops.review.restockable.yes")}</option>
                    <option value="no">{t("ops.review.restockable.no")}</option>
                  </select>
                </span>{" "}
                {t("ops.review.sentence.courierJoin")}{" "}
                <span className="ledger-select-wrap">
                  <select
                    className="ledger-inline-select"
                    value={courierClaim ? "yes" : "no"}
                    onChange={(event) => setCourierClaim(event.target.value === "yes")}
                    disabled={submitting || rejecting}
                  >
                    <option value="yes">{t("ops.review.courierClaim.yes")}</option>
                    <option value="no">{t("ops.review.courierClaim.no")}</option>
                  </select>
                </span>.
              </p>
              {formatConfidence(returnCase.aiConfidence) ? (
                <p className="ledger-confidence">
                  {t("ops.review.confidenceLabel")} {formatConfidence(returnCase.aiConfidence)}
                  <span className="ledger-confidence-raw"> ({returnCase.aiConfidence?.toFixed(2)})</span>
                </p>
              ) : null}

              {!rejecting ? (
                <form className="ledger-form" onSubmit={onAccept}>
                  <div className="ledger-field">
                    <label className="ledger-field-label" htmlFor="ops-message">{t("ops.review.messageLabel")}</label>
                    <textarea
                      id="ops-message"
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      disabled={submitting}
                    />
                    <span className="ledger-hint">{t("ops.review.messageHint")}</span>
                  </div>

                  {submitStage === "update-failed" ? <p className="ledger-form-error">{t("ops.review.updateFailed")}</p> : null}

                  <div className="ledger-form-actions">
                    <button
                      type="button"
                      className="ledger-submit ledger-submit-secondary"
                      onClick={() => setRejecting(true)}
                      disabled={submitting}
                    >
                      {t("ops.review.rejectToggle")}
                    </button>
                    <button type="submit" className="ledger-submit" disabled={submitting}>
                      {submitting ? t("ops.review.accepting") : t("ops.review.accept")}
                    </button>
                  </div>
                </form>
              ) : (
                <form className="ledger-form" onSubmit={onReject}>
                  <div className="ledger-field">
                    <label className="ledger-field-label" htmlFor="ops-rejection-reason">{t("ops.review.rejectReasonLabel")}</label>
                    <textarea
                      id="ops-rejection-reason"
                      value={rejectionReason}
                      onChange={(event) => setRejectionReason(event.target.value)}
                      disabled={submitting}
                    />
                    <span className="ledger-hint">{t("ops.review.rejectReasonHint")}</span>
                  </div>

                  {rejectionValidationError ? <p className="ledger-form-error">{rejectionValidationError}</p> : null}
                  {submitStage === "update-failed" ? <p className="ledger-form-error">{t("ops.review.updateFailed")}</p> : null}

                  <div className="ledger-form-actions">
                    <button
                      type="button"
                      className="ledger-submit ledger-submit-secondary"
                      onClick={() => {
                        setRejecting(false);
                        setRejectionValidationError(undefined);
                      }}
                      disabled={submitting}
                    >
                      {t("ops.review.rejectCancel")}
                    </button>
                    <button type="submit" className="ledger-submit ledger-submit-warn" disabled={submitting}>
                      {submitting ? t("ops.review.rejecting") : t("ops.review.reject")}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

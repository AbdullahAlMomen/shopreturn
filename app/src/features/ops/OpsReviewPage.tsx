import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ErrorState } from "../../shared/ui/ErrorState";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useT } from "../../lib/i18n/LocalizationProvider";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useRoles } from "../../lib/blocks/useRoles";
import { useReviewReturn } from "./useReviewReturn";
import type { ReviewReturnCase, TimelineEntry } from "./useReviewReturn";
import { useInspection } from "./useInspection";
import type { ConditionOnArrival, FaultAttribution } from "./useInspection";
import { useRefund } from "./useRefund";
import type { RefundMethod } from "./useRefund";

// Task 3 extends this same screen (rather than adding a separate
// OpsCasePage.tsx) to become the full case page: /ops/review?id=... is
// already the queue's only entry point (OpsQueuePage.tsx's goToReview),
// and Task 2's "already reviewed" branch already proved this component is
// the right home for post-decision, read-only/guarded-action states. A
// second page at a second route would just be this same id-driven screen
// with an extra hop to reach it.
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

const CONDITIONS: ConditionOnArrival[] = ["GOOD", "MINOR_DAMAGE", "MAJOR_DAMAGE", "UNUSABLE"];
const FAULTS: FaultAttribution[] = ["COURIER", "SELLER", "CUSTOMER"];
const REFUND_METHODS: RefundMethod[] = ["BKASH", "NAGAD", "BANK"];

type Translate = (key: TranslationKey, fallback?: string) => string;

function reasonLabel(reason: string, t: Translate): string {
  const key = `ops.review.reason.${reason}` as TranslationKey;
  return t(key, reason);
}

function conditionLabel(condition: ConditionOnArrival, t: Translate): string {
  return t(`ops.case.inspection.condition.${condition}` as TranslationKey, condition);
}

function faultLabel(fault: FaultAttribution, t: Translate): string {
  return t(`ops.case.inspection.fault.${fault}` as TranslationKey, fault);
}

function methodLabel(method: RefundMethod, t: Translate): string {
  return t(`ops.case.refund.method.${method}` as TranslationKey, method);
}

function formatConfidence(value?: number): string | undefined {
  if (typeof value !== "number") return undefined;
  return `${Math.round(value * 100)}%`;
}

function formatMoney(amount: number): string {
  return `৳${(Number.isFinite(amount) ? amount : 0).toLocaleString("en-US")}`;
}

// The customer-facing default for a Record Inspection message. Deliberately
// built ONLY from conditionOnArrival/faultAttribution -- never from
// inspectorNotes, which is a separate field entirely (see useInspection.ts).
// This is a suggestion ops can edit or overwrite before publishing.
function defaultInspectionMessage(condition: ConditionOnArrival, fault: FaultAttribution, t: Translate): string {
  if (condition === "GOOD") return t("ops.case.inspection.messageDefault.good");
  if (fault === "CUSTOMER") return t("ops.case.inspection.messageDefault.damagedCustomer");
  return t("ops.case.inspection.messageDefault.damagedNotYourFault");
}

// The one line every refund message must carry (amount, method, reference)
// -- built deterministically from the current form values, not free-typed,
// so an ops edit can only add to it, never remove the required content.
function refundCoreLine(amount: number, method: RefundMethod, reference: string, t: Translate): string {
  return t("ops.case.refund.messageCore")
    .replace("{amount}", formatMoney(amount))
    .replace("{method}", methodLabel(method, t))
    .replace("{reference}", reference.trim() || "—");
}

function formatWhen(iso?: string): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", hour12: false, minute: "2-digit" });
}

// Shared shape for the three "second/third write failed" banners this page
// renders (useReviewReturn's own pendingNotify, plus useInspection's and
// useRefund's update-failed/notify-failed stages). A write that already
// committed is never retried or rolled back -- only the specific failed
// write is retried, which is why each banner takes exactly one retry
// action, never a resubmit-the-form action.
function StageBanner({
  title, body, retryLabel, retryingLabel, submitting, onRetry
}: {
  title: string; body: string; retryLabel: string; retryingLabel: string; submitting: boolean; onRetry: () => void;
}) {
  return (
    <div className="ledger-notify-banner">
      <p className="ledger-notify-banner-title">{title}</p>
      <p>{body}</p>
      <button type="button" className="ledger-submit ledger-submit-warn" onClick={onRetry} disabled={submitting}>
        {submitting ? retryingLabel : retryLabel}
      </button>
    </div>
  );
}

function TimelineHistory({ timeline, t }: { timeline: TimelineEntry[]; t: Translate }) {
  if (timeline.length === 0) return null;
  return (
    <div className="ledger-case-section">
      <p className="ledger-label">{t("ops.case.timelineLabel")}</p>
      <div className="ledger-rows">
        {timeline.map((entry) => (
          <div key={entry.ItemId} className="ledger-row" data-customer-visible={String(entry.isCustomerVisible ?? true)}>
            <div className="ledger-when">{formatWhen(entry.at ?? entry.CreatedDate)}</div>
            <div className="ledger-message">
              <p>
                <strong>{entry.status}</strong> &middot; {entry.message}
                {entry.isCustomerVisible === false ? ` (${t("ops.case.internalOnly")})` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OpsReviewPage() {
  const { t } = useT();
  const { hasRole, roles } = useRoles();
  const itemId = currentReviewId();
  const {
    returnCase, timeline, refund, loading, loadError,
    accept, reject, markReceived, startRefund, retryNotify,
    submitting, submitStage, pendingNotify, refetch
  } = useReviewReturn(itemId);
  const inspection = useInspection();
  const refundAction = useRefund();

  // Ops' working edits to the AI's reading (review stage only).
  const [reason, setReason] = useState<string>("");
  const [restockable, setRestockable] = useState(true);
  const [courierClaim, setCourierClaim] = useState(false);
  const [message, setMessage] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionValidationError, setRejectionValidationError] = useState<string>();

  // Mark received / start refund -- single editable message fields.
  const [receivedMessage, setReceivedMessage] = useState("");
  const [startRefundMessage, setStartRefundMessage] = useState("");

  // Record inspection.
  const [condition, setCondition] = useState<ConditionOnArrival>("GOOD");
  const [inspRestockable, setInspRestockable] = useState(true);
  const [fault, setFault] = useState<FaultAttribution>("SELLER");
  const [inspectorNotes, setInspectorNotes] = useState("");
  const [inspectionMessage, setInspectionMessage] = useState("");
  const [inspectionMessageEdited, setInspectionMessageEdited] = useState(false);

  // Record refund.
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("BKASH");
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundReference, setRefundReference] = useState("");
  const [refundNote, setRefundNote] = useState("");

  // Seeds each stage's editable fields exactly once per stage, the first
  // time the case is observed at that status -- NOT on every `returnCase`
  // reference change. useReviewReturn.load() sets a brand-new object on
  // every refetch (including the refetches this page triggers after every
  // guarded action below), so keying this off `[returnCase]` would reset
  // whatever ops is mid-typing each time a retry or an unrelated refetch
  // runs. A per-stage "already seeded" set is what actually matches the
  // "seed once, let ops edit freely after" behavior the accept/reject flow
  // established in Task 2.
  const seededStagesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const status = returnCase?.status;
    const stageKey = status || "SUBMITTED";
    if (seededStagesRef.current.has(stageKey)) return;
    seededStagesRef.current.add(stageKey);

    if (!status || status === "SUBMITTED") {
      setReason(returnCase?.aiReason ?? REASONS[0]);
      setRestockable(returnCase?.aiRestockable ?? true);
      setCourierClaim(returnCase?.aiCourierClaim ?? false);
      setMessage(returnCase?.aiDraftMessage ?? "");
    } else if (status === "ACCEPTED") {
      setReceivedMessage(t("ops.case.markReceived.messageDefault"));
    } else if (status === "RECEIVED") {
      setCondition("GOOD");
      setInspRestockable(true);
      setFault("SELLER");
      setInspectorNotes("");
      setInspectionMessage(defaultInspectionMessage("GOOD", "SELLER", t));
      setInspectionMessageEdited(false);
    } else if (status === "INSPECTED") {
      setStartRefundMessage(t("ops.case.startRefund.messageDefault"));
    } else if (status === "REFUND_PROCESSING") {
      setRefundMethod("BKASH");
      setRefundAmount(returnCase?.unitPrice ?? 0);
      setRefundReference("");
      setRefundNote("");
    }
  }, [returnCase, t]);

  // Keeps the inspection message following condition/fault until ops types
  // into it directly -- after that, their edit is never overwritten.
  useEffect(() => {
    if (inspectionMessageEdited) return;
    setInspectionMessage(defaultInspectionMessage(condition, fault, t));
  }, [condition, fault, inspectionMessageEdited, t]);

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

  async function onMarkReceived(event: FormEvent) {
    event.preventDefault();
    await markReceived(receivedMessage.trim());
  }

  async function onStartRefund(event: FormEvent) {
    event.preventDefault();
    await startRefund(startRefundMessage.trim());
  }

  async function onRecordInspection(event: FormEvent) {
    event.preventDefault();
    if (!returnCase?.customerItemId || !itemId) return;
    const ok = await inspection.recordInspection({
      returnId: itemId,
      customerItemId: returnCase.customerItemId,
      conditionOnArrival: condition,
      restockable: inspRestockable,
      faultAttribution: fault,
      inspectorNotes,
      message: inspectionMessage.trim()
    });
    if (ok) await refetch();
  }

  async function onRecordRefund(event: FormEvent) {
    event.preventDefault();
    if (!returnCase?.customerItemId || !itemId) return;
    const core = refundCoreLine(refundAmount, refundMethod, refundReference, t);
    const fullMessage = refundNote.trim() ? `${core} ${refundNote.trim()}` : core;
    const ok = await refundAction.recordRefund({
      returnId: itemId,
      customerItemId: returnCase.customerItemId,
      method: refundMethod,
      amount: refundAmount,
      reference: refundReference.trim(),
      message: fullMessage
    });
    if (ok) await refetch();
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

  const status = returnCase?.status;
  const isAwaitingDecision = !status || status === "SUBMITTED";

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

          <TimelineHistory timeline={timeline} t={t} />

          {pendingNotify ? (
            <div className="ledger-case-section">
              <StageBanner
                title={t("ops.review.notifyFailed.title")}
                body={t("ops.review.notifyFailed.body").replace("{status}", pendingNotify.status)}
                retryLabel={t("ops.review.notifyFailed.retry")}
                retryingLabel={t("ops.review.notifyFailed.retrying")}
                submitting={submitting}
                onRetry={() => void retryNotify()}
              />
            </div>
          ) : isAwaitingDecision ? (
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
          ) : status === "ACCEPTED" ? (
            <form className="ledger-form ledger-case-section" onSubmit={onMarkReceived}>
              <p className="ledger-case-title">{t("ops.case.markReceived.title")}</p>
              <div className="ledger-field">
                <label className="ledger-field-label" htmlFor="ops-received-message">{t("ops.review.messageLabel")}</label>
                <textarea
                  id="ops-received-message"
                  value={receivedMessage}
                  onChange={(event) => setReceivedMessage(event.target.value)}
                  disabled={submitting}
                />
              </div>
              {submitStage === "update-failed" ? <p className="ledger-form-error">{t("ops.review.updateFailed")}</p> : null}
              <div className="ledger-form-actions">
                <button type="submit" className="ledger-submit" disabled={submitting}>
                  {submitting ? t("ops.case.markReceived.confirming") : t("ops.case.markReceived.confirm")}
                </button>
              </div>
            </form>
          ) : status === "RECEIVED" ? (
            inspection.stage === "update-failed" ? (
              <div className="ledger-case-section">
                <StageBanner
                  title={t("ops.case.updateFailed.title")}
                  body={t("ops.case.updateFailed.body")}
                  retryLabel={t("ops.case.updateFailed.retry")}
                  retryingLabel={t("ops.case.updateFailed.retrying")}
                  submitting={inspection.submitting}
                  onRetry={() => void inspection.retryUpdate().then(() => refetch())}
                />
              </div>
            ) : inspection.stage === "notify-failed" ? (
              <div className="ledger-case-section">
                <StageBanner
                  title={t("ops.review.notifyFailed.title")}
                  body={t("ops.review.notifyFailed.body").replace("{status}", "INSPECTED")}
                  retryLabel={t("ops.case.notifyFailed.retry")}
                  retryingLabel={t("ops.case.notifyFailed.retrying")}
                  submitting={inspection.submitting}
                  onRetry={() => void inspection.retryNotify().then(() => refetch())}
                />
              </div>
            ) : (
              <form className="ledger-form ledger-case-section" onSubmit={onRecordInspection}>
                <p className="ledger-case-title">{t("ops.case.inspection.title")}</p>

                <div className="ledger-field">
                  <label className="ledger-field-label" htmlFor="ops-condition">{t("ops.case.inspection.conditionLabel")}</label>
                  <select
                    id="ops-condition"
                    value={condition}
                    onChange={(event) => setCondition(event.target.value as ConditionOnArrival)}
                    disabled={inspection.submitting}
                  >
                    {CONDITIONS.map((option) => (
                      <option key={option} value={option}>{conditionLabel(option, t)}</option>
                    ))}
                  </select>
                </div>

                <div className="ledger-field">
                  <label className="ledger-field-label" htmlFor="ops-insp-restockable">{t("ops.case.inspection.restockableLabel")}</label>
                  <select
                    id="ops-insp-restockable"
                    value={inspRestockable ? "yes" : "no"}
                    onChange={(event) => setInspRestockable(event.target.value === "yes")}
                    disabled={inspection.submitting}
                  >
                    <option value="yes">{t("ops.review.restockable.yes")}</option>
                    <option value="no">{t("ops.review.restockable.no")}</option>
                  </select>
                </div>

                <div className="ledger-field">
                  <label className="ledger-field-label" htmlFor="ops-fault">{t("ops.case.inspection.faultLabel")}</label>
                  <select
                    id="ops-fault"
                    value={fault}
                    onChange={(event) => setFault(event.target.value as FaultAttribution)}
                    disabled={inspection.submitting}
                  >
                    {FAULTS.map((option) => (
                      <option key={option} value={option}>{faultLabel(option, t)}</option>
                    ))}
                  </select>
                </div>

                <div className="ledger-field">
                  <label className="ledger-field-label" htmlFor="ops-insp-notes">{t("ops.case.inspection.notesLabel")}</label>
                  <textarea
                    id="ops-insp-notes"
                    value={inspectorNotes}
                    onChange={(event) => setInspectorNotes(event.target.value)}
                    disabled={inspection.submitting}
                  />
                  <span className="ledger-hint">{t("ops.case.inspection.notesHint")}</span>
                </div>

                <div className="ledger-field">
                  <label className="ledger-field-label" htmlFor="ops-insp-message">{t("ops.case.inspection.messageLabel")}</label>
                  <textarea
                    id="ops-insp-message"
                    value={inspectionMessage}
                    onChange={(event) => {
                      setInspectionMessage(event.target.value);
                      setInspectionMessageEdited(true);
                    }}
                    disabled={inspection.submitting}
                  />
                  <span className="ledger-hint">{t("ops.case.inspection.messageHint")}</span>
                </div>

                {inspection.stage === "insert-failed" ? <p className="ledger-form-error">{t("ops.case.recordFailed")}</p> : null}

                <div className="ledger-form-actions">
                  <button type="submit" className="ledger-submit" disabled={inspection.submitting}>
                    {inspection.submitting ? t("ops.case.inspection.submitting") : t("ops.case.inspection.submit")}
                  </button>
                </div>
              </form>
            )
          ) : status === "INSPECTED" ? (
            <form className="ledger-form ledger-case-section" onSubmit={onStartRefund}>
              <p className="ledger-case-title">{t("ops.case.startRefund.title")}</p>
              <div className="ledger-field">
                <label className="ledger-field-label" htmlFor="ops-start-refund-message">{t("ops.review.messageLabel")}</label>
                <textarea
                  id="ops-start-refund-message"
                  value={startRefundMessage}
                  onChange={(event) => setStartRefundMessage(event.target.value)}
                  disabled={submitting}
                />
              </div>
              {submitStage === "update-failed" ? <p className="ledger-form-error">{t("ops.review.updateFailed")}</p> : null}
              <div className="ledger-form-actions">
                <button type="submit" className="ledger-submit" disabled={submitting}>
                  {submitting ? t("ops.case.startRefund.confirming") : t("ops.case.startRefund.confirm")}
                </button>
              </div>
            </form>
          ) : status === "REFUND_PROCESSING" ? (
            refundAction.stage === "update-failed" ? (
              <div className="ledger-case-section">
                <StageBanner
                  title={t("ops.case.updateFailed.title")}
                  body={t("ops.case.updateFailed.body")}
                  retryLabel={t("ops.case.updateFailed.retry")}
                  retryingLabel={t("ops.case.updateFailed.retrying")}
                  submitting={refundAction.submitting}
                  onRetry={() => void refundAction.retryUpdate().then(() => refetch())}
                />
              </div>
            ) : refundAction.stage === "notify-failed" ? (
              <div className="ledger-case-section">
                <StageBanner
                  title={t("ops.review.notifyFailed.title")}
                  body={t("ops.review.notifyFailed.body").replace("{status}", "REFUNDED")}
                  retryLabel={t("ops.case.notifyFailed.retry")}
                  retryingLabel={t("ops.case.notifyFailed.retrying")}
                  submitting={refundAction.submitting}
                  onRetry={() => void refundAction.retryNotify().then(() => refetch())}
                />
              </div>
            ) : (
              <form className="ledger-form ledger-case-section" onSubmit={onRecordRefund}>
                <p className="ledger-case-title">{t("ops.case.refund.title")}</p>

                <div className="ledger-field">
                  <label className="ledger-field-label" htmlFor="ops-refund-method">{t("ops.case.refund.methodLabel")}</label>
                  <select
                    id="ops-refund-method"
                    value={refundMethod}
                    onChange={(event) => setRefundMethod(event.target.value as RefundMethod)}
                    disabled={refundAction.submitting}
                  >
                    {REFUND_METHODS.map((option) => (
                      <option key={option} value={option}>{methodLabel(option, t)}</option>
                    ))}
                  </select>
                </div>

                <div className="ledger-field">
                  <label className="ledger-field-label" htmlFor="ops-refund-amount">{t("ops.case.refund.amountLabel")}</label>
                  <input
                    id="ops-refund-amount"
                    type="number"
                    min={0}
                    step="0.01"
                    value={refundAmount}
                    onChange={(event) => setRefundAmount(Number(event.target.value))}
                    disabled={refundAction.submitting}
                  />
                </div>

                <div className="ledger-field">
                  <label className="ledger-field-label" htmlFor="ops-refund-reference">{t("ops.case.refund.referenceLabel")}</label>
                  <input
                    id="ops-refund-reference"
                    type="text"
                    value={refundReference}
                    onChange={(event) => setRefundReference(event.target.value)}
                    disabled={refundAction.submitting}
                  />
                  <span className="ledger-hint">{t("ops.case.refund.referenceHint")}</span>
                </div>

                <p className="ledger-hint">{refundCoreLine(refundAmount, refundMethod, refundReference, t)}</p>

                <div className="ledger-field">
                  <label className="ledger-field-label" htmlFor="ops-refund-note">{t("ops.case.refund.noteLabel")}</label>
                  <textarea
                    id="ops-refund-note"
                    value={refundNote}
                    onChange={(event) => setRefundNote(event.target.value)}
                    disabled={refundAction.submitting}
                  />
                  <span className="ledger-hint">{t("ops.case.refund.noteHint")}</span>
                </div>

                {refundAction.stage === "insert-failed" ? <p className="ledger-form-error">{t("ops.case.recordFailed")}</p> : null}

                <div className="ledger-form-actions">
                  <button type="submit" className="ledger-submit" disabled={refundAction.submitting || !refundReference.trim()}>
                    {refundAction.submitting ? t("ops.case.refund.submitting") : t("ops.case.refund.submit")}
                  </button>
                </div>
              </form>
            )
          ) : (
            <div className="ledger-terminal-summary">
              <p className="ledger-label">{t("ops.case.terminal.title")}</p>
              {status === "REFUNDED" && refund ? (
                <p>
                  {t("ops.case.terminal.refundedBody")
                    .replace("{amount}", formatMoney(refund.amount ?? 0))
                    .replace("{method}", refund.method ?? "")
                    .replace("{reference}", refund.reference ?? "")}
                </p>
              ) : status === "REJECTED" ? (
                <p>{t("ops.review.reviewed.rejectedBody").replace("{reason}", returnCase.rejectionReason ?? "")}</p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

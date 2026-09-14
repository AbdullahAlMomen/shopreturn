import { ArrowLeft, Paperclip, X } from "lucide-react";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { useSubmitReturn } from "./useSubmitReturn";
import type { SubmitReturnResult } from "./useSubmitReturn";

// Same pushState + synthetic popstate pattern MyReturnsPage/ReturnDetailPage
// use -- the hand-rolled router only matches pathname, so this lands on the
// same history entry a "real" navigate() call would produce.
function goToReturn(itemId: string) {
  window.history.pushState({}, "", `/returns?id=${encodeURIComponent(itemId)}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function goToMyReturns() {
  window.history.pushState({}, "", "/returns");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function NewReturnPage() {
  const { t } = useT();
  const { submit, submitting, error } = useSubmitReturn();

  const [orderNumber, setOrderNumber] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [validationError, setValidationError] = useState<string>();
  const [result, setResult] = useState<SubmitReturnResult>();

  function onPhotosSelected(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length > 0) setPhotos((prev) => [...prev, ...selected]);
    // Reset so picking the same file again (after removing it below) still fires onChange.
    event.target.value = "";
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmedOrder = orderNumber.trim();
    const trimmedDescription = description.trim();
    if (!trimmedOrder || !trimmedDescription) {
      setValidationError(t("returns.new.validation"));
      return;
    }
    setValidationError(undefined);

    const outcome = await submit({ orderNumber: trimmedOrder, rawCustomerText: trimmedDescription, photos });
    if (!outcome) return;

    if (outcome.photoFailures.length === 0) {
      // Happy path: go straight to the new return, nothing to show first.
      goToReturn(outcome.itemId);
    } else {
      // The return was created regardless -- see useSubmitReturn.ts. Stay here
      // and say exactly which photos didn't make it rather than silently
      // dropping them or blocking the submission on a broken upload path.
      setResult(outcome);
    }
  }

  function errorMessage(): string | undefined {
    if (!error) return undefined;
    if (error.startsWith("no-order:")) {
      const order = error.slice("no-order:".length);
      return t("returns.new.orderNotFound").replace("{order}", order);
    }
    if (error === "no-session") return t("returns.new.noSession");
    if (error === "create-failed") return t("returns.new.submitFailed");
    return error;
  }

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

      <div className="ledger-page">
        <header>
          <h1 className="ledger-order">{t("returns.new.title")}</h1>
          <p className="ledger-subtitle">{t("returns.new.subtitle")}</p>
        </header>

        {result ? (
          <div className="ledger-success-panel">
            <h2>{t("returns.new.photoWarningTitle")}</h2>
            <p className="ledger-hint">{t("returns.new.photoWarningBody")}</p>
            <ul className="ledger-photo-failures">
              {result.photoFailures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
            <div className="ledger-form-actions">
              <button type="button" className="ledger-submit" onClick={() => goToReturn(result.itemId)}>
                {t("returns.new.viewReturn")}
              </button>
            </div>
          </div>
        ) : (
          <form className="ledger-form" onSubmit={onSubmit}>
            <div className="ledger-field">
              <label className="ledger-field-label" htmlFor="order-number">{t("returns.new.orderNumberLabel")}</label>
              <input
                id="order-number"
                type="text"
                className="mono"
                placeholder={t("returns.new.orderNumberPlaceholder")}
                value={orderNumber}
                onChange={(event) => setOrderNumber(event.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="ledger-field">
              <label className="ledger-field-label" htmlFor="description">{t("returns.new.descriptionLabel")}</label>
              <textarea
                id="description"
                placeholder={t("returns.new.descriptionHint")}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={submitting}
              />
              <span className="ledger-hint">{t("returns.new.descriptionHint")}</span>
            </div>

            <div className="ledger-field">
              <span className="ledger-field-label">{t("returns.new.photosLabel")}</span>
              <span className="ledger-hint">{t("returns.new.photosHint")}</span>
              <label className="ledger-photo-input-label">
                <Paperclip size={14} /> {t("returns.new.addPhotos")}
                <input type="file" accept="image/*" multiple onChange={onPhotosSelected} disabled={submitting} />
              </label>
              {photos.length > 0 ? (
                <div className="ledger-photo-list">
                  {photos.map((photo, index) => (
                    <span className="ledger-photo-chip" key={`${photo.name}-${index}`}>
                      {photo.name}
                      <button type="button" onClick={() => removePhoto(index)} disabled={submitting} aria-label={t("returns.new.removePhoto").replace("{name}", photo.name)}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {validationError ? <p className="ledger-form-error">{validationError}</p> : null}
            {errorMessage() ? <p className="ledger-form-error">{errorMessage()}</p> : null}

            <div className="ledger-form-actions">
              <button type="submit" className="ledger-submit" disabled={submitting}>
                {submitting ? t("returns.new.submitting") : t("returns.new.submit")}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

import { formatPercent, formatTaka } from "./analytics";
import type { Facet } from "./analytics";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { BREACH_RATE } from "./thresholds";

export function FacetBars({
  title,
  facets,
  showRate,
  labelFor
}: {
  title: string;
  facets: Facet[];
  showRate: boolean;
  labelFor?: (facet: Facet) => string;
}) {
  const { t } = useT();
  const shown = facets.slice(0, 6);
  const max = Math.max(1, ...shown.map((facet) => facet.takaImpact));

  return (
    <section className="facet">
      <h3 className="facet-title">{title}</h3>
      <ol className="facet-list">
        {shown.map((facet) => {
          const breach = showRate && facet.rate >= BREACH_RATE;
          // A facet whose key is missing lands in the analytics layer's
          // explicit UNSPECIFIED bucket (see analytics.ts) rather than being
          // dropped. That bucket must still read as a real row here, not as
          // the literal string "UNSPECIFIED" or a blank label -- this check
          // comes before labelFor/facet.label and applies to every facet.
          const label =
            facet.key === "UNSPECIFIED"
              ? t("insights.facet.unspecified")
              : labelFor
                ? labelFor(facet)
                : facet.label;
          return (
            <li key={facet.key} className="facet-row">
              <div className="facet-row-head">
                <span className="facet-label">{label}</span>
                <span className="facet-value">{formatTaka(facet.takaImpact)}</span>
              </div>
              <div className="facet-track" aria-hidden="true">
                <div
                  className={breach ? "facet-bar facet-bar-breach" : "facet-bar"}
                  style={{ width: `${Math.max(2, (facet.takaImpact / max) * 100)}%` }}
                />
              </div>
              <div className="facet-row-foot">
                <span>
                  {facet.returns} {t("insights.facet.returns")}
                  {showRate ? ` / ${facet.orders} ${t("insights.facet.orders")}` : ""}
                </span>
                {showRate ? (
                  <span className={breach ? "facet-rate facet-rate-breach" : "facet-rate"}>
                    {formatPercent(facet.rate)} {t("insights.facet.rate")}
                    {/* Stated in words as well as colour: a breach must not
                        depend on telling two hues apart. */}
                    {breach ? ` ${t("insights.facet.breach")}` : ""}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

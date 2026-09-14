import { AlertTriangle } from "lucide-react";
import { useT } from "../../lib/i18n/LocalizationProvider";

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useT();
  return (
    <div className="error-state">
      <AlertTriangle size={20} />
      <span>{message}</span>
      {onRetry ? <button className="link-button" onClick={onRetry}>{t("common.retry")}</button> : null}
    </div>
  );
}

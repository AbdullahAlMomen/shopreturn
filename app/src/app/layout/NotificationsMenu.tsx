import { Bell, CheckCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../../shared/ui/dropdown-menu";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { describeNotification } from "./describeNotification";
import { useNotifications } from "./useNotifications";

export function NotificationsMenu({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useT();
  const { items, unread, error, loading, markRead, markAllRead, refresh } = useNotifications();
  const badge = unread > 9 ? "9+" : String(unread);
  const triggerLabel = unread > 0
    ? `${t("notifications.title")} (${unread} ${t("notifications.unread")})`
    : t("notifications.title");

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) void refresh(); }}>
      <DropdownMenuTrigger className="icon-button notif-trigger" aria-label={triggerLabel}>
        <Bell size={18} />
        {unread > 0 ? <span className="notif-badge" aria-hidden="true">{badge}</span> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="notif-menu">
        <div className="notif-header">
          <DropdownMenuLabel>{t("notifications.title")}</DropdownMenuLabel>
          {unread > 0 ? (
            <button type="button" className="notif-mark-all" onClick={() => void markAllRead()}>
              {t("notifications.markAllRead")}
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {error ? (
          // A failed read must never be shown as "all caught up".
          <p className="notif-error" role="alert">{t("notifications.loadError")}</p>
        ) : loading ? null : items.length === 0 ? (
          // Until the first read lands there is nothing true to say, so the
          // empty state waits for it rather than claiming "all caught up".
          <div className="notif-empty">
            <CheckCheck size={22} aria-hidden="true" />
            <p>{t("notifications.empty")}</p>
          </div>
        ) : (
          items.map((item, index) => {
            const view = describeNotification(item);
            const sentence = Object.entries(view.replacements).reduce(
              (acc, [name, value]) => acc.replace(`{${name}}`, value),
              t(view.key)
            );
            return (
              <DropdownMenuItem
                key={item.id ?? `notification-${index}`}
                className={item.isRead ? "notif-item" : "notif-item notif-item-unread"}
                onSelect={() => {
                  if (item.id && !item.isRead) void markRead(item.id);
                  if (view.href) onNavigate(view.href);
                }}
              >
                {!item.isRead ? <span className="notif-unread-marker">{t("notifications.unread")}</span> : null}
                <span className="notif-text">{sentence}</span>
                {item.createdTime ? <span className="notif-time">{new Date(item.createdTime).toLocaleString()}</span> : null}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

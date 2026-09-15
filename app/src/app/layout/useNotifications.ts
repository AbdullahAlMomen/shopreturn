import { useCallback, useEffect, useState } from "react";
import { blocksClient } from "../../lib/blocks/client";
import type { NotificationItem } from "./describeNotification";

// The SDK has no real-time client, so the bell reads the persisted inbox and
// refreshes on open, on focus, and on an interval while the tab is visible.
// getNotifications is ZERO-indexed: page 1 of a one-page inbox is empty.
export function useNotifications(pollMs = 30_000) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await blocksClient.notifier.getNotifications({ page: 0, pageSize: 20 });
      // A missing list is a failed read, not an empty inbox.
      if (!res || !Array.isArray(res.notifications)) throw new Error("notifications missing from response");
      setItems(res.notifications as NotificationItem[]);
      setUnread(typeof res.unReadNotificationsCount === "number" ? res.unReadNotificationsCount : 0);
      setError(undefined);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const whenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(whenVisible, pollMs);
    window.addEventListener("focus", whenVisible);
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", whenVisible);
      document.removeEventListener("visibilitychange", whenVisible);
    };
  }, [refresh, pollMs]);

  const markRead = useCallback(async (id: string) => {
    try {
      await blocksClient.notifier.markNotificationAsRead({ id });
    } catch (caught) {
      // Callers fire this with `void`; a failed mark must not become an
      // unhandled rejection. The refresh below shows the true read state.
      console.warn("[notifications] mark as read failed", caught);
    } finally {
      await refresh();
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    try {
      await blocksClient.notifier.markAllNotificationAsRead();
    } catch (caught) {
      console.warn("[notifications] mark all as read failed", caught);
    } finally {
      await refresh();
    }
  }, [refresh]);

  return { items, unread, error, loading, refresh, markRead, markAllRead };
}

import type { TranslationKey } from "../../lib/i18n/dictionary";

export type NotificationItem = {
  id?: string;
  isRead?: boolean;
  createdTime?: string;
  denormalizedPayload?: unknown;
};

export type NotificationView = {
  key: TranslationKey;
  replacements: Record<string, string>;
  href?: string;
};

function payloadOf(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

// Unknown kinds render generically instead of crashing the menu: a newer
// sender must never break an older bell.
export function describeNotification(item: NotificationItem): NotificationView {
  const payload = payloadOf(item.denormalizedPayload);
  if (payload.kind === "RETURN_SUBMITTED" && text(payload.returnId)) {
    return {
      key: "notifications.returnSubmitted",
      replacements: { orderNumber: text(payload.orderNumber) },
      href: `/ops/review?id=${encodeURIComponent(text(payload.returnId))}`
    };
  }
  if (payload.kind === "PATTERN_ALERT") {
    return {
      key: "notifications.patternAlert",
      replacements: { value: text(payload.value), metric: text(payload.metric) },
      href: "/insights"
    };
  }
  return { key: "notifications.generic", replacements: {} };
}

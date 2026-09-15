// Client-free by design: no import of ./client (or anything that imports
// it), so this module can be unit-tested outside a browser without
// constructing the Blocks SDK client.

export const NOTIFICATION_CONFIGURATION = "shopreturn";

export type NotificationKind = "RETURN_SUBMITTED" | "PATTERN_ALERT";

export type NotifyRequest = {
  configurationName: string;
  connectionId: string;
  responseKey: string;
  responseValue: string;
  roles: string[];
  denormalizedPayload: string;
  saveDenormalizedPayloadAsAnObject: boolean;
};

// The notifier requires all five of configurationName, connectionId,
// responseKey, responseValue and denormalizedPayload, even though the SDK
// types mark them optional. "" is an accepted connectionId.
export function buildNotifyRequest(role: string, kind: NotificationKind, payload: Record<string, string | number>): NotifyRequest {
  return {
    configurationName: NOTIFICATION_CONFIGURATION,
    connectionId: "",
    responseKey: NOTIFICATION_CONFIGURATION,
    responseValue: kind,
    roles: [role],
    denormalizedPayload: JSON.stringify({ kind, ...payload }),
    saveDenormalizedPayloadAsAnObject: true
  };
}

// A missing configuration comes back as a 200 with isSuccess false and an
// errors OBJECT, not an HTTP error -- every failure shape must be checked.
export function notifyFailed(response: unknown): boolean {
  if (!response || typeof response !== "object") return true;
  const r = response as { errors?: unknown; isSuccess?: unknown };
  if (r.isSuccess === false) return true;
  if (Array.isArray(r.errors)) return r.errors.length > 0;
  if (r.errors && typeof r.errors === "object") return Object.keys(r.errors).length > 0;
  return false;
}

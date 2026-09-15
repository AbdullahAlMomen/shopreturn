import { blocksClient } from "./client";
import { buildNotifyRequest, notifyFailed, NOTIFICATION_CONFIGURATION } from "./notifyRequest";
import type { NotificationKind } from "./notifyRequest";

export { NOTIFICATION_CONFIGURATION };
export type { NotificationKind };

// Fire-and-forget by contract: callers send AFTER their own write has
// landed, and a failed notification must never undo or block that write.
export async function notifyRole(role: string, kind: NotificationKind, payload: Record<string, string | number>): Promise<boolean> {
  try {
    const response = await blocksClient.notifier.notify(buildNotifyRequest(role, kind, payload));
    if (notifyFailed(response)) {
      console.warn(`[notify] ${kind} to ${role} was not accepted`, response);
      return false;
    }
    return true;
  } catch (caught) {
    console.warn(`[notify] ${kind} to ${role} failed`, caught);
    return false;
  }
}

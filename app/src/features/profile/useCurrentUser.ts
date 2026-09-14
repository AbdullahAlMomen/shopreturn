import type { BlocksUser } from "@seliseblocks/client";
import { useMe } from "../../lib/blocks/useMe";

// Kept as the profile feature's name for the shared identity query defined
// in lib/blocks/useMe.ts. Both names hit the same queryKey, so adding a
// caller costs no extra request.
export const useCurrentUser = useMe;

export function userDisplayName(profile?: BlocksUser): string {
  if (!profile) return "";
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  return name || profile.email || "";
}

export function userInitials(profile?: BlocksUser): string {
  if (!profile) return "?";
  const first = profile.firstName?.[0];
  const last = profile.lastName?.[0];
  if (first || last) return `${first ?? ""}${last ?? ""}`.toUpperCase();
  return (profile.email?.[0] ?? "?").toUpperCase();
}

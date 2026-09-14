import { useMemo } from "react";
import { useAuth } from "../../app/providers/AuthProvider";

// Source of truth for "what can this user do in the UI" is the JWT claims
// AuthProvider already decodes (`useAuth().claims`), NOT `iam.me()`. The two
// disagree in shape -- the JWT claim is a flat string ("roles": "manager"),
// while iam.me() returns a nested object (roles: { default: ["customer"] })
// -- and blocks/data/rules.json's access policies match against the JWT
// claim (leftOperand "roles"). Gating on iam.me() would risk the UI and the
// server disagreeing about who can do what.
//
// Every account on this project so far carries exactly one role, so a
// multi-role token has never actually been observed. The comma-separated
// string and array branches below are a defensive guess at how such a claim
// might be shaped, NOT a verified behavior -- treat multi-role support here
// as an assumption until someone tests it against a real multi-role token.
function normalizeRolesClaim(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

export type UseRolesResult = {
  hasRole: (slug: string) => boolean;
  isCustomer: boolean;
  roles: string[];
};

export function useRoles(): UseRolesResult {
  const { claims } = useAuth();

  const roles = useMemo(() => normalizeRolesClaim(claims?.roles), [claims]);

  return useMemo(
    () => ({
      hasRole: (slug: string) => roles.includes(slug),
      isCustomer: roles.includes("customer"),
      roles
    }),
    [roles]
  );
}

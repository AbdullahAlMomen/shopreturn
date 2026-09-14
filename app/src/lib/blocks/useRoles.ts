import { useMemo } from "react";
import { useMe } from "./useMe";

// Where the UI's role knowledge comes from, and why it is NOT the session
// claims.
//
// This hook previously read `useAuth().claims.roles`. That was wrong, and
// wrong in the quiet way: under the hosted OIDC flow `claims` is the
// *userinfo document*, and userinfo carries no roles at all. Verified live
// against the project -- `auth.userInfo()` returns exactly:
//
//   ["sub", "name", "preferred_username", "email", "tenant_id", "org_id"]
//
// so `claims.roles` was always `undefined`, every normalize call returned
// `[]`, and `hasRole()` answered false for every user including ops. Nothing
// errored; the role-gated nav items simply never appeared.
//
// The JWT *access token* does carry the claim (`"roles": "customer"`, a flat
// string, which is what blocks/data/rules.json matches on) -- but in the
// cookie flow that token is httpOnly and never reaches this app's JS, so the
// browser cannot read it. `iam.me()` is the only role source available here,
// and it reports the same values: `data.roles: ["customer"]`, verified live.
//
// This remains UX-only. The server (blocks/data/rules.json) is the boundary;
// if iam.me() and the token ever disagreed, the token would win and the user
// would get a server denial rather than unauthorized access.
function normalizeRolesClaim(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((entry) => String(entry).trim()).filter(Boolean);
  }
  // The token-claim shape, kept because a future non-cookie flow could feed
  // this hook the decoded JWT instead, where "roles" is a flat string.
  if (typeof raw === "string") {
    return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

export type UseRolesResult = {
  hasRole: (slug: string) => boolean;
  isCustomer: boolean;
  // True while roles are still unknown. Callers that *deny* on a missing
  // role must wait for this to go false, otherwise they show "not for your
  // role" to a user who simply hasn't loaded yet.
  isLoading: boolean;
  roles: string[];
};

export function useRoles(): UseRolesResult {
  const me = useMe();

  const roles = useMemo(() => normalizeRolesClaim(me.data?.data?.roles), [me.data]);

  return useMemo(
    () => ({
      hasRole: (slug: string) => roles.includes(slug),
      isCustomer: roles.includes("customer"),
      isLoading: me.isPending,
      roles
    }),
    [me.isPending, roles]
  );
}

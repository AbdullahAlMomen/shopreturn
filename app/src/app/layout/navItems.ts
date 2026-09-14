import { ClipboardList, FilePlus2, PackageOpen, TrendingUp, UserRound } from "lucide-react";

// `requiresRole`, where present, is UX-only: it hides an affordance the
// server would reject anyway (see blocks/data/rules.json -- "New return"
// is gated to the customer role there). It is not itself an access check;
// the server remains the only enforcement boundary. "/ops" is gated the
// same way for the same reason -- and, deliberately, only to "ops": manager
// gets analytics, not this operational queue (spec keeps the two separate).
// The manager gets "/insights" and not "/ops", because the manager decides
// causes (the pattern behind a stack of cases) and ops decides cases (the
// one return in front of them).
export const navItems = [
  { href: "/", labelKey: "nav.profile", icon: UserRound, requiresRole: undefined },
  { href: "/returns", labelKey: "nav.returns", icon: PackageOpen, requiresRole: undefined },
  { href: "/returns/new", labelKey: "nav.newReturn", icon: FilePlus2, requiresRole: "customer" },
  { href: "/ops", labelKey: "nav.ops", icon: ClipboardList, requiresRole: "ops" },
  { href: "/insights", labelKey: "nav.insights", icon: TrendingUp, requiresRole: "manager" }
] as const;

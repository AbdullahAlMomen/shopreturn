import { FilePlus2, PackageOpen, UserRound } from "lucide-react";

// `requiresRole`, where present, is UX-only: it hides an affordance the
// server would reject anyway (see blocks/data/rules.json -- "New return"
// is gated to the customer role there). It is not itself an access check;
// the server remains the only enforcement boundary.
export const navItems = [
  { href: "/", labelKey: "nav.profile", icon: UserRound, requiresRole: undefined },
  { href: "/returns", labelKey: "nav.returns", icon: PackageOpen, requiresRole: undefined },
  { href: "/returns/new", labelKey: "nav.newReturn", icon: FilePlus2, requiresRole: "customer" }
] as const;

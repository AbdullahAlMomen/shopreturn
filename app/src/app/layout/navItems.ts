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
//
// `staffLabelKey`, where present, is shown instead of `labelKey` for a
// signed-in user who isn't a customer. Explicitly set to `undefined` on
// every other entry (same convention as `requiresRole` above) rather than
// omitted, so every entry's inferred type carries the property -- with
// `noUncheckedIndexedAccess` and this array declared `as const`, an entry
// that simply lacked the key wouldn't type-check when read through the
// union type AppShell iterates over.
export const navItems = [
  { href: "/", labelKey: "nav.profile", staffLabelKey: undefined, icon: UserRound, requiresRole: undefined },
  {
    href: "/returns",
    labelKey: "nav.returns",
    // ops/manager both get server-side read access to every return case
    // (see blocks/data/rules.json's staff-reads-all-returns /
    // manager-reads-all-returns), so "My returns" would misdescribe what
    // this page lists for them.
    staffLabelKey: "nav.returnsAll",
    icon: PackageOpen,
    requiresRole: undefined
  },
  { href: "/returns/new", labelKey: "nav.newReturn", staffLabelKey: undefined, icon: FilePlus2, requiresRole: "customer" },
  { href: "/ops", labelKey: "nav.ops", staffLabelKey: undefined, icon: ClipboardList, requiresRole: "ops" },
  { href: "/insights", labelKey: "nav.insights", staffLabelKey: undefined, icon: TrendingUp, requiresRole: "manager" }
] as const;

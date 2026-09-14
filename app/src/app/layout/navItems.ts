import { FilePlus2, PackageOpen, UserRound } from "lucide-react";

export const navItems = [
  { href: "/", labelKey: "nav.profile", icon: UserRound },
  { href: "/returns", labelKey: "nav.returns", icon: PackageOpen },
  { href: "/returns/new", labelKey: "nav.newReturn", icon: FilePlus2 }
] as const;

import { PackageOpen, UserRound } from "lucide-react";

export const navItems = [
  { href: "/", labelKey: "nav.profile", icon: UserRound },
  { href: "/returns", labelKey: "nav.returns", icon: PackageOpen }
] as const;

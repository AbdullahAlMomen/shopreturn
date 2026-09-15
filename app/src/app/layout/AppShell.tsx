import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { navItems } from "./navItems";
import { NotificationsMenu } from "./NotificationsMenu";
import { UserMenu } from "./UserMenu";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { useRoles } from "../../lib/blocks/useRoles";

const COLLAPSED_KEY = "blocks-app:sidebar-collapsed";
const MOBILE_QUERY = "(max-width: 880px)";

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

export function AppShell({ activePath, children, onNavigate }: { activePath: string; children: ReactNode; onNavigate: (path: string) => void }) {
  const isMobile = useIsMobile();
  const [collapsedPref, setCollapsedPref] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "true");
  const { t } = useT();
  const { hasRole, isCustomer, isLoading: rolesLoading } = useRoles();
  // On narrow screens the sidebar is always the icon-only rail below --
  // no separate hamburger/drawer/scrim needed, and no dead-end state where
  // nothing on screen can bring navigation back.
  const collapsed = collapsedPref || isMobile;
  // Hiding an item here is a UX courtesy only -- the server (blocks/data/rules.json)
  // is what actually enforces who can do what; this just avoids offering a
  // control that would come back as an opaque AUTH_NOT_AUTHENTICATED error.
  const visibleNavItems = navItems.filter((item) => !item.requiresRole || hasRole(item.requiresRole));
  const activeItem = visibleNavItems.find((item) => item.href === activePath);
  // While roles are still loading, `isCustomer` reads false for everyone --
  // treat that the same as "is a customer" here so the nav never flashes
  // the staff wording at a customer before iam.me() resolves.
  const isStaffView = !rolesLoading && !isCustomer;
  const navLabel = (item: (typeof navItems)[number]) => (item.staffLabelKey && isStaffView ? item.staffLabelKey : item.labelKey);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsedPref));
  }, [collapsedPref]);

  return (
    <div className="shell">
      <aside className={collapsed ? "collapsed" : ""}>
        <div className="sidebar-header">
          {/* Collapsed rail keeps the mark and drops only the wordmark --
             same trade the nav items below make with their labels. The
             wordmark carries the link's accessible name when expanded; an
             aria-label stands in for it once that text is gone. */}
          <a
            className="brand"
            href="/"
            aria-label={collapsed ? t("app.name") : undefined}
            onClick={(event) => { event.preventDefault(); onNavigate("/"); }}
          >
            <span className="brand-mark"><img src="/logo.svg" alt="" width={20} height={20} /></span>
            {collapsed ? null : <span>{t("app.name")}</span>}
          </a>
          {/* Hidden on mobile by CSS (nothing to toggle -- the rail is always
             collapsed there); on desktop it's the only control that can
             re-expand the sidebar, so it must never be the thing collapsing hides. */}
          <button className="icon-button sidebar-collapse-toggle" onClick={() => setCollapsedPref((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <PanelLeft size={16} />
          </button>
        </div>
        <nav>
          {visibleNavItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              data-tooltip={t(navLabel(item))}
              className={activePath === item.href ? "active" : ""}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(item.href);
              }}
            >
              <item.icon size={18} />
              {collapsed ? null : <span>{t(navLabel(item))}</span>}
            </a>
          ))}
        </nav>
      </aside>
      <div className="content">
        <header className="topbar">
          {activeItem ? (
            <div className="breadcrumb">
              <activeItem.icon size={16} />
              <span>{t(navLabel(activeItem))}</span>
            </div>
          ) : null}
          <div className="topbar-spacer" />
          <LanguageSwitcher />
          <NotificationsMenu onNavigate={onNavigate} />
          <UserMenu onNavigate={onNavigate} />
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}

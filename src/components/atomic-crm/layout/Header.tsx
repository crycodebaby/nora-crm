import {
  CalendarClock,
  FileText,
  History,
  Import,
  Settings,
  User,
  Users,
} from "lucide-react";
import { CanAccess, useTranslate, useUserMenu } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";
import { RefreshButton } from "@/components/admin/refresh-button";
import { ThemeModeToggle } from "@/components/admin/theme-mode-toggle";
import { UserMenu } from "@/components/admin/user-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

import { GlobalSearch } from "./GlobalSearch";
import { QuickCaptureTrigger } from "../quickCapture/QuickCaptureTrigger";
import { ImportPage } from "../misc/ImportPage";
import { ChangelogPage } from "../misc/ChangelogPage";
import { AuditPage } from "../audit/AuditPage";
import { GoogleCalendarAdminPage } from "../calendar/GoogleCalendarAdminPage";
import { getActiveNoraResource, noraCreatePath } from "../routing/noraRoutes";
import noraMonogram from "@/assets/nora-monogram.png";

const Header = () => {
  const location = useLocation();
  const translate = useTranslate();

  let currentPath: string | boolean = "/";
  const activeResource = getActiveNoraResource(location.pathname);
  if (matchPath("/", location.pathname)) {
    currentPath = "/";
  } else if (activeResource === "companies") {
    currentPath = "companies";
  } else if (activeResource === "deals") {
    currentPath = "deals";
  } else {
    currentPath = false;
  }

  return (
    <>
      <nav
        className="sticky top-0 z-40 grow"
        aria-label={translate("crm.navigation.label")}
      >
        <header className="border-b border-border bg-background">
          <div className="px-4 md:px-6">
            <div className="flex min-h-14 justify-between items-center gap-3 flex-1 min-w-0">
              <Link
                to="/"
                className="flex items-center gap-2 text-foreground no-underline shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nora-brand-ring)]"
                aria-label="Nora – Startseite"
              >
                <img
                  className="size-14 object-contain"
                  src={noraMonogram}
                  alt=""
                  aria-hidden="true"
                />
                <h1 className="text-base font-semibold tracking-tight">Nora</h1>
              </Link>
              <nav
                aria-label="Hauptnavigation"
                className="hidden md:flex shrink-0 items-center gap-1"
              >
                <NavigationTab
                  label="Startseite"
                  to="/"
                  isActive={currentPath === "/"}
                />
                <NavigationTab
                  label={translate("resources.companies.name", {
                    smart_count: 2,
                  })}
                  to={noraCreatePath({ resource: "companies", type: "list" })}
                  isActive={currentPath === "companies"}
                />
                <NavigationTab
                  label={translate("resources.deals.name", {
                    smart_count: 2,
                  })}
                  to={noraCreatePath({ resource: "deals", type: "list" })}
                  isActive={currentPath === "deals"}
                />
              </nav>
              <GlobalSearch className="hidden min-w-[12rem] max-w-sm flex-1 xl:flex" />
              <QuickCaptureTrigger
                variant="header"
                className="nora-touch-target w-11 px-0 xl:w-auto xl:px-4"
              />
              <div className="flex items-center shrink-0">
                <ThemeModeToggle />
                <RefreshButton />
                <UserMenu>
                  <ProfileMenu />
                  <CanAccess resource="sales" action="list">
                    <UsersMenu />
                  </CanAccess>
                  <SettingsMenu />
                  <CanAccess
                    resource="google_calendar_connections"
                    action="list"
                  >
                    <GoogleCalendarMenuItem />
                  </CanAccess>
                  <CanAccess resource="configuration" action="edit">
                    <ImportFromJsonMenuItem />
                  </CanAccess>
                  <CanAccess resource="audit_events" action="list">
                    <AuditMenuItem />
                  </CanAccess>
                  <ChangelogMenuItem />
                </UserMenu>
              </div>
            </div>
          </div>
        </header>
      </nav>
    </>
  );
};

const NavigationTab = ({
  label,
  to,
  isActive,
}: {
  label: string;
  to: string;
  isActive: boolean;
}) => (
  <Link
    to={to}
    aria-current={isActive ? "page" : undefined}
    className={`min-h-11 rounded-md px-3 text-sm font-medium transition-colors inline-flex items-center justify-center nora-touch-target xl:px-4 ${
      isActive
        ? "text-[var(--nora-brand-hover)] bg-[var(--nora-brand-soft)]"
        : "text-muted-foreground hover:text-foreground hover:bg-muted"
    }`}
  >
    {label}
  </Link>
);

const UsersMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<UsersMenu> must be used inside <UserMenu?");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/sales" className="flex items-center gap-2">
        <Users />
        {translate("resources.sales.name", { smart_count: 2 })}
      </Link>
    </DropdownMenuItem>
  );
};

const ProfileMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ProfileMenu> must be used inside <UserMenu?");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/profile" className="flex items-center gap-2">
        <User />
        {translate("crm.profile.title")}
      </Link>
    </DropdownMenuItem>
  );
};

const SettingsMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<SettingsMenu> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/settings" className="flex items-center gap-2">
        <Settings />
        {translate("crm.settings.title")}
      </Link>
    </DropdownMenuItem>
  );
};

const ImportFromJsonMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ImportFromJsonMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to={ImportPage.path} className="flex items-center gap-2">
        <Import />
        {translate("crm.header.import_data")}
      </Link>
    </DropdownMenuItem>
  );
};

const GoogleCalendarMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<GoogleCalendarMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link
        to={GoogleCalendarAdminPage.path}
        className="flex items-center gap-2"
      >
        <CalendarClock />
        {translate("crm.calendar.admin.menu")}
      </Link>
    </DropdownMenuItem>
  );
};

const ChangelogMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ChangelogMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to={ChangelogPage.path} className="flex items-center gap-2">
        <FileText />
        {translate("crm.changelog.title")}
      </Link>
    </DropdownMenuItem>
  );
};

const AuditMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<AuditMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to={AuditPage.path} className="flex items-center gap-2">
        <History />
        {translate("crm.audit.page_title")}
      </Link>
    </DropdownMenuItem>
  );
};
export default Header;

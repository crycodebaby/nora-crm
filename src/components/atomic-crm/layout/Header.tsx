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
import { DemoRoleSwitcher } from "../misc/DemoRoleSwitcher";
import { QuickCaptureTrigger } from "../quickCapture/QuickCaptureTrigger";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { ImportPage } from "../misc/ImportPage";
import { ChangelogPage } from "../misc/ChangelogPage";
import { AuditPage } from "../audit/AuditPage";
import { GoogleCalendarAdminPage } from "../calendar/GoogleCalendarAdminPage";
import { getActiveNoraResource, noraCreatePath } from "../routing/noraRoutes";

const Header = () => {
  const { darkModeLogo, lightModeLogo, title } = useConfigurationContext();
  const location = useLocation();
  const translate = useTranslate();

  let currentPath: string | boolean = "/";
  const activeResource = getActiveNoraResource(location.pathname);
  if (matchPath("/", location.pathname)) {
    currentPath = "/";
  } else if (activeResource === "contacts") {
    currentPath = "contacts";
  } else if (activeResource === "companies") {
    currentPath = "companies";
  } else if (activeResource === "deals") {
    currentPath = "deals";
  } else {
    currentPath = false;
  }

  return (
    <>
      <nav className="grow">
        <header className="bg-secondary">
          <div className="px-4">
            <div className="flex justify-between items-center gap-3 flex-1 min-w-0">
              <Link
                to="/"
                className="flex items-center gap-2 text-secondary-foreground no-underline shrink-0"
              >
                <img
                  className="[.light_&]:hidden h-6"
                  src={darkModeLogo}
                  alt={title}
                />
                <img
                  className="[.dark_&]:hidden h-6"
                  src={lightModeLogo}
                  alt={title}
                />
                <h1 className="text-xl font-semibold">{title}</h1>
              </Link>
              <nav className="hidden md:flex shrink-0">
                <NavigationTab
                  label={translate("ra.page.dashboard")}
                  to="/"
                  isActive={currentPath === "/"}
                />
                <NavigationTab
                  label={translate("resources.contacts.name", {
                    smart_count: 2,
                  })}
                  to={noraCreatePath({ resource: "contacts", type: "list" })}
                  isActive={currentPath === "contacts"}
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
              <GlobalSearch className="hidden md:flex flex-1 max-w-sm min-w-[12rem]" />
              <QuickCaptureTrigger variant="header" />
              <DemoRoleSwitcher className="hidden md:flex" />
              <div className="flex items-center shrink-0">
                <ThemeModeToggle />
                <RefreshButton />
                <UserMenu>
                  <ProfileMenu />
                  <CanAccess resource="sales" action="list">
                    <UsersMenu />
                  </CanAccess>
                  <CanAccess resource="configuration" action="edit">
                    <SettingsMenu />
                  </CanAccess>
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
    className={`px-5 py-3.5 md:py-3 text-sm font-medium transition-colors border-b-2 nora-touch-target ${
      isActive
        ? "text-secondary-foreground border-[var(--nora-brand)]"
        : "text-secondary-foreground/70 border-transparent hover:text-secondary-foreground/80"
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

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Building2, Home, ListTodo, Plus, Settings } from "lucide-react";
import { CanAccess, useTranslate } from "ra-core";
import { Link, useLocation, useMatch } from "react-router";
import { ContactCreateSheet } from "../contacts/ContactCreateSheet";
import { useState } from "react";
import { NoteCreateSheet } from "../notes/NoteCreateSheet";
import { TaskCreateSheet } from "../tasks/TaskCreateSheet";
import { getActiveNoraResource, noraCreatePath } from "../routing/noraRoutes";
import { useQuickCapture } from "../quickCapture/useQuickCapture";
import { GlobalSearch } from "./GlobalSearch";

export const MobileNavigation = () => {
  const location = useLocation();
  const translate = useTranslate();

  const activeResource = getActiveNoraResource(location.pathname);
  let currentPath: string | boolean = "/";
  if (location.pathname === "/") {
    currentPath = "/";
  } else if (activeResource === "companies") {
    currentPath = "companies";
  } else if (matchPathTasks(location.pathname)) {
    currentPath = "/tasks";
  } else {
    currentPath = false;
  }

  const isPwa = window.matchMedia("(display-mode: standalone)").matches;
  const isWebiOS = /iPad|iPod|iPhone/.test(window.navigator.userAgent);

  return (
    <nav
      aria-label={translate("crm.navigation.label")}
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background h-16"
      style={{
        paddingBottom: isPwa && isWebiOS ? 15 : undefined,
        height: isPwa && isWebiOS ? "calc(4rem + 15px)" : "4rem",
      }}
    >
      <div className="mx-auto flex h-full max-w-screen-md justify-center items-center gap-1 px-2">
        <>
          <GlobalSearch variant="mobile" />
          <NavigationButton
            href="/"
            Icon={Home}
            label="Start"
            isActive={currentPath === "/"}
          />
          <NavigationButton
            href={noraCreatePath({ resource: "companies", type: "list" })}
            Icon={Building2}
            label={translate("resources.companies.name", {
              smart_count: 2,
            })}
            isActive={currentPath === "companies"}
          />
          <MobileCreateButton />
          <NavigationButton
            href="/tasks"
            Icon={ListTodo}
            label={translate("resources.tasks.name", { smart_count: 2 })}
            isActive={currentPath === "/tasks"}
          />
          <SettingsButton />
        </>
      </div>
    </nav>
  );
};

const matchPathTasks = (pathname: string) =>
  pathname === "/tasks" || pathname.startsWith("/tasks/");

const NavigationButton = ({
  href,
  Icon,
  label,
  isActive,
}: {
  href: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  isActive: boolean;
}) => (
  <Button
    asChild
    variant="ghost"
    className={cn(
      "nora-touch-target flex min-h-11 min-w-11 flex-1 max-w-20 flex-col gap-1 h-auto py-2 px-1 rounded-md",
      isActive
        ? "bg-[var(--nora-brand-soft)] text-[var(--nora-brand-hover)]"
        : "text-muted-foreground",
    )}
  >
    <Link to={href}>
      <Icon className="size-5" />
      <span className="text-[0.6875rem] font-medium leading-tight">
        {label}
      </span>
    </Link>
  </Button>
);

const MobileCreateButton = () => {
  const translate = useTranslate();
  const { openQuickCapture } = useQuickCapture();
  const germanContactMatch = useMatch("/kontakte/:id/*");
  const legacyContactMatch = useMatch("/contacts/:id/*");
  const contactMatch = germanContactMatch ?? legacyContactMatch;
  const contact_id = contactMatch?.params.id;
  const [contactCreateOpen, setContactCreateOpen] = useState(false);
  const [noteCreateOpen, setNoteCreateOpen] = useState(false);
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);

  return (
    <CanAccess resource="deals" action="create">
      <>
        <ContactCreateSheet
          open={contactCreateOpen}
          onOpenChange={setContactCreateOpen}
        />
        <NoteCreateSheet
          open={noteCreateOpen}
          onOpenChange={setNoteCreateOpen}
          contact_id={contact_id}
        />
        <TaskCreateSheet
          open={taskCreateOpen}
          onOpenChange={setTaskCreateOpen}
          contact_id={contact_id}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              className="size-14 rounded-full -mt-3 nora-primary-action shadow-md"
              aria-label={translate("ra.action.create")}
            >
              <Plus className="size-10" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              className="h-12 px-4 text-base"
              onSelect={openQuickCapture}
            >
              {translate("crm.quick_capture.capture_new_inquiry")}
            </DropdownMenuItem>
            <CanAccess resource="contacts" action="create">
              <DropdownMenuItem
                className="h-12 px-4 text-base"
                onSelect={() => {
                  setContactCreateOpen(true);
                }}
              >
                {translate("resources.contacts.forcedCaseName")}
              </DropdownMenuItem>
            </CanAccess>
            <CanAccess resource="contact_notes" action="create">
              <DropdownMenuItem
                className="h-12 px-4 text-base"
                onSelect={() => {
                  setNoteCreateOpen(true);
                }}
              >
                {translate("resources.notes.forcedCaseName")}
              </DropdownMenuItem>
            </CanAccess>
            <CanAccess resource="tasks" action="create">
              <DropdownMenuItem
                className="h-12 px-4 text-base"
                onSelect={() => {
                  setTaskCreateOpen(true);
                }}
              >
                {translate("resources.tasks.forcedCaseName")}
              </DropdownMenuItem>
            </CanAccess>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    </CanAccess>
  );
};

const SettingsButton = () => {
  const translate = useTranslate();
  const location = useLocation();
  const isActive = location.pathname.startsWith("/settings");

  return (
    <NavigationButton
      href="/settings"
      Icon={Settings}
      label={translate("crm.settings.title")}
      isActive={isActive}
    />
  );
};

import { CheckSquare } from "lucide-react";
import {
  useGetIdentity,
  useGetList,
  useGetMany,
  useRedirect,
  useTranslate,
  CanAccess,
} from "ra-core";
import { useMemo } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { AddTask } from "../tasks/AddTask";
import { noraCreatePath } from "../routing/noraRoutes";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Task } from "../types";
import { HOTBOARD_DEAL_LIMIT } from "./hotboardUtils";

export const HotboardOpenTasks = ({ className }: { className?: string }) => {
  const translate = useTranslate();
  const { identity } = useGetIdentity();
  const { taskTypes } = useConfigurationContext();

  const { data: tasks, isPending } = useGetList<Task>("tasks", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "due_date", order: "ASC" },
    filter: identity?.id ? { sales_id: identity.id } : {},
  });

  const openTasks = useMemo(
    () =>
      tasks
        ?.filter((task) => task.done_date == null)
        .slice(0, HOTBOARD_DEAL_LIMIT) ?? [],
    [tasks],
  );

  const contactIds = useMemo(
    () => openTasks.map((task) => task.contact_id),
    [openTasks],
  );

  const { data: contacts } = useGetMany(
    "contacts",
    { ids: contactIds },
    { enabled: contactIds.length > 0 },
  );

  const contactById = useMemo(() => {
    const map = new Map<
      string | number,
      { first_name: string; last_name: string }
    >();
    for (const contact of contacts ?? []) {
      map.set(contact.id, contact);
    }
    return map;
  }, [contacts]);

  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        <CheckSquare
          className="h-5 w-5 text-muted-foreground shrink-0"
          aria-hidden
        />
        <h2 className="text-base font-semibold tracking-tight flex-1">
          {translate("crm.dashboard.hotboard.open_tasks")}
        </h2>
        <CanAccess resource="tasks" action="create">
          <AddTask display="icon" selectContact />
        </CanAccess>
      </div>
      <Card className="nora-card divide-y overflow-hidden">
        {isPending ? (
          <p className="px-4 py-6 text-sm text-center text-muted-foreground">
            {translate("crm.common.loading")}
          </p>
        ) : openTasks.length > 0 ? (
          openTasks.map((task) => (
            <HotboardTaskRow
              key={task.id}
              task={task}
              taskTypes={taskTypes}
              contact={contactById.get(task.contact_id)}
            />
          ))
        ) : (
          <p className="px-4 py-6 text-sm text-center text-muted-foreground nora-readable">
            {translate("crm.dashboard.hotboard.empty_section")}
          </p>
        )}
      </Card>
    </section>
  );
};

const HotboardTaskRow = ({
  task,
  taskTypes,
  contact,
}: {
  task: Task;
  taskTypes: { value: string; label: string }[];
  contact?: { first_name: string; last_name: string };
}) => {
  const translate = useTranslate();
  const redirect = useRedirect();

  const typeLabel =
    taskTypes.find((t) => t.value === task.type)?.label ?? task.type;

  const contactLabel = contact
    ? `${contact.first_name} ${contact.last_name}`.trim()
    : null;

  const openContact = () => {
    redirect(
      noraCreatePath({
        resource: "contacts",
        type: "show",
        id: task.contact_id,
      }),
      undefined,
      undefined,
      undefined,
      { _scrollToTop: false },
    );
  };

  return (
    <button
      type="button"
      onClick={openContact}
      className="w-full text-left px-4 py-3.5 hover:bg-muted/60 transition-colors nora-touch-target flex flex-col gap-1"
      aria-label={`${translate("crm.dashboard.hotboard.open_directly")}: ${task.text}`}
    >
      <span className="nora-list-title text-sm leading-snug">{task.text}</span>
      <span className="nora-muted text-xs">
        {typeLabel}
        {contactLabel ? ` · ${contactLabel}` : null}
        {task.due_date ? ` · ${task.due_date}` : null}
      </span>
    </button>
  );
};

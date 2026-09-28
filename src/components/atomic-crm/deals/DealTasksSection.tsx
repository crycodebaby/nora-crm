import {
  type Identifier,
  useGetList,
  useRecordContext,
  useTranslate,
} from "ra-core";

import { AddTask } from "../tasks/AddTask";
import { Task } from "../tasks/Task";
import { isDone, isRecentlyDone } from "../tasks/tasksPredicate";
import { NoraSectionCard } from "../misc/NoraSectionCard";
import type { Deal, Task as TaskRecord } from "../types";

/**
 * Tasks that belong to this Vorgang, i.e. tasks of its linked contacts
 * (tasks carry no `deal_id` — see 01-domain-model).
 *
 * One primary action: "Aufgabe hinzufügen". Rows are a dense grid — type,
 * text, due, responsible, actions — so the office can scan the section
 * without reading it; open tasks first, recently completed ones last.
 */
export const DealTasksSection = () => {
  const translate = useTranslate();
  const deal = useRecordContext<Deal>();
  const contactIds = deal?.contact_ids ?? [];
  const primaryContactId = contactIds[0];

  const { data: tasks, isPending } = useGetList<TaskRecord>(
    "tasks",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "due_date", order: "ASC" },
      filter: { "contact_id@in": `(${contactIds.join(",")})` },
    },
    { enabled: contactIds.length > 0 },
  );

  const visibleTasks =
    tasks?.filter(
      (task) =>
        !isDone({ ...task, done_date: task.done_date ?? null }) ||
        isRecentlyDone({ ...task, done_date: task.done_date ?? null }),
    ) ?? [];
  // Open tasks by due date first, recently completed ones after them.
  const orderedTasks = [
    ...visibleTasks.filter((task) => !task.done_date),
    ...visibleTasks.filter((task) => task.done_date),
  ];
  const openCount = visibleTasks.filter((task) => !task.done_date).length;

  return (
    <NoraSectionCard
      title={translate("resources.deals.tasks.title")}
      count={contactIds.length && !isPending ? openCount : null}
      dense
      actions={
        primaryContactId != null ? (
          <AddTask display="primary" contactId={primaryContactId} />
        ) : null
      }
    >
      {!contactIds.length ? (
        <p className="nora-t-meta">
          {translate("resources.deals.tasks.no_contact")}
        </p>
      ) : isPending ? null : !orderedTasks.length ? (
        <p className="nora-t-meta">
          {translate("resources.deals.tasks.empty")}
        </p>
      ) : (
        <DealTaskGrid tasks={orderedTasks} contactIds={contactIds} />
      )}
    </NoraSectionCard>
  );
};

const DealTaskGrid = ({
  tasks,
  contactIds,
}: {
  tasks: TaskRecord[];
  contactIds: Identifier[];
}) => {
  const translate = useTranslate();
  return (
    <div className="nora-task-grid" role="table">
      <div className="nora-task-grid-head" role="row" aria-hidden>
        <span />
        <span>{translate("resources.tasks.fields.type")}</span>
        <span>{translate("resources.tasks.fields.text")}</span>
        <span>{translate("resources.tasks.fields.due_date")}</span>
        <span>{translate("resources.tasks.fields.sales_id")}</span>
        <span />
      </div>
      {tasks.map((task) => (
        <Task
          key={task.id}
          task={task}
          showContact={contactIds.length > 1}
          showHolder
          variant="row"
        />
      ))}
    </div>
  );
};

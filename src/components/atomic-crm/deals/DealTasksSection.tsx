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
 * One primary action: "Aufgabe hinzufügen". The former per-type quick
 * buttons opened the very same dialog with the type preselected, which the
 * dialog's own type field already offers — four buttons for one action.
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

  const openTasks =
    tasks?.filter(
      (task) =>
        !isDone({ ...task, done_date: task.done_date ?? null }) ||
        isRecentlyDone({ ...task, done_date: task.done_date ?? null }),
    ) ?? [];

  const openCount = openTasks.filter((task) => !task.done_date).length;

  return (
    <NoraSectionCard
      title={translate("resources.deals.tasks.title")}
      count={contactIds.length && !isPending ? openCount : null}
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
      ) : isPending ? null : !openTasks.length ? (
        <p className="nora-t-meta">
          {translate("resources.deals.tasks.empty")}
        </p>
      ) : (
        <DealTaskList tasks={openTasks} contactIds={contactIds} />
      )}
    </NoraSectionCard>
  );
};

const DealTaskList = ({
  tasks,
  contactIds,
}: {
  tasks: TaskRecord[];
  contactIds: Identifier[];
}) => (
  <ul className="nora-task-list" aria-label={undefined}>
    {tasks.map((task) => (
      <li key={task.id} className="list-none">
        <Task task={task} showContact={contactIds.length > 1} showHolder />
      </li>
    ))}
  </ul>
);

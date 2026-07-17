import {
  type Identifier,
  useGetList,
  useRecordContext,
  useTranslate,
} from "ra-core";

import { AddTask } from "../tasks/AddTask";
import { Task } from "../tasks/Task";
import { isDone, isRecentlyDone } from "../tasks/tasksPredicate";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal, Task as TaskRecord } from "../types";

const QUICK_TASK_TYPES = [
  "rueckruf",
  "besichtigung",
  "angebot-nachfassen",
  "termin-vereinbaren",
] as const;

export const DealTasksSection = () => {
  const translate = useTranslate();
  const deal = useRecordContext<Deal>();
  const { taskTypes } = useConfigurationContext();

  if (!deal?.contact_ids?.length) {
    return (
      <p className="nora-muted text-sm">
        {translate("resources.deals.tasks.no_contact")}
      </p>
    );
  }

  const primaryContactId = deal.contact_ids[0];

  return (
    <div className="flex flex-col gap-4">
      <DealTasksList contactIds={deal.contact_ids} />
      <div className="flex flex-wrap gap-2">
        {QUICK_TASK_TYPES.map((typeValue) => {
          const taskType = taskTypes.find((t) => t.value === typeValue);
          if (!taskType) return null;
          return (
            <AddTask
              key={typeValue}
              display="chip"
              contactId={primaryContactId}
              defaultTaskType={typeValue}
              defaultTaskText={taskType.label}
            />
          );
        })}
      </div>
      <AddTask contactId={primaryContactId} />
    </div>
  );
};

const DealTasksList = ({ contactIds }: { contactIds: Identifier[] }) => {
  const translate = useTranslate();
  const filterValue = `(${contactIds.join(",")})`;

  const { data: tasks, isPending } = useGetList<TaskRecord>("tasks", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "due_date", order: "ASC" },
    filter: {
      "contact_id@in": filterValue,
    },
  });

  const openTasks =
    tasks?.filter(
      (task) =>
        !isDone({ ...task, done_date: task.done_date ?? null }) ||
        isRecentlyDone({ ...task, done_date: task.done_date ?? null }),
    ) ?? [];

  if (isPending) {
    return null;
  }

  if (!openTasks.length) {
    return (
      <p className="nora-muted text-sm">
        {translate("resources.deals.tasks.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {openTasks.map((task) => (
        <Task task={task} showContact={contactIds.length > 1} key={task.id} />
      ))}
    </div>
  );
};

import { useGetList, useRecordContext, useTranslate } from "ra-core";
import { Skeleton } from "@/components/ui/skeleton";

import { TasksListByDueDate } from "../tasks/TasksListByDueDate";
import { AddTask } from "../tasks/AddTask";
import type { Company, Contact } from "../types";

// Kunden-Aufgabenbereich (Unified Tasks Wave): shows every task with
// task.company_id = this customer, whether or not it also has a contact —
// see docs/nora/06-decision-log.md "2026-08-25 – Unified Tasks Wave".
export const CompanyTasksList = () => {
  const record = useRecordContext<Company>();
  const translate = useTranslate();

  const { data: primaryContacts } = useGetList<Contact>(
    "contacts",
    {
      pagination: { page: 1, perPage: 1 },
      filter: { company_id: record?.id, is_primary: true },
    },
    { enabled: record?.id != null },
  );
  const primaryContactId = primaryContacts?.[0]?.id;

  if (!record) return null;

  return (
    <div className="flex flex-col gap-4">
      <TasksListByDueDate
        filterByCompany={record.id}
        emptyPlaceholder={
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-muted-foreground mb-4">
              {translate("resources.tasks.empty")}
            </p>
            <AddTask
              companyId={record.id}
              companyName={record.name}
              contactId={primaryContactId}
              display="chip"
            />
          </div>
        }
        pendingPlaceholder={
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton className="w-full h-10" key={index} />
            ))}
          </div>
        }
      />
      <div>
        <AddTask
          companyId={record.id}
          companyName={record.name}
          contactId={primaryContactId}
          display="chip"
        />
      </div>
    </div>
  );
};

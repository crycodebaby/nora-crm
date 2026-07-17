import { useRecordContext, useTranslate } from "ra-core";
import { ShowButton } from "@/components/admin/show-button";
import { ReferenceManyField } from "@/components/admin/reference-many-field";

import { NoraDeleteButton, NoraEditButton } from "../misc/NoraAccessActions";
import { NoraWriteAccess } from "../misc/NoraAccessActions";

import { AddTask } from "../tasks/AddTask";
import { TasksIterator } from "../tasks/TasksIterator";
import { TagsListEdit } from "./TagsListEdit";
import { ContactStatusSelector } from "./ContactInputs";
import { ContactPersonalInfo } from "./ContactPersonalInfo";
import { ContactBackgroundInfo } from "./ContactBackgroundInfo";
import { AsideSection } from "../misc/AsideSection";
import type { Contact } from "../types";
import { ContactMergeButton } from "./ContactMergeButton";
import { ExportVCardButton } from "./ExportVCardButton";

export const ContactAside = ({ link = "edit" }: { link?: "edit" | "show" }) => {
  const record = useRecordContext<Contact>();
  const translate = useTranslate();

  if (!record) return null;

  return (
    <div className="hidden sm:block w-92 min-w-92 text-sm">
      <div className="mb-4 -ml-1">
        {link === "edit" ? (
          <NoraEditButton resource="contacts" label="resources.contacts.action.edit" />
        ) : (
          <ShowButton label="resources.contacts.action.show" />
        )}
      </div>

      <NoraWriteAccess resource="contacts" action="edit">
        <AsideSection title={translate("resources.notes.fields.status")}>
          <ContactStatusSelector />
        </AsideSection>
      </NoraWriteAccess>

      <AsideSection
        title={translate("resources.contacts.field_categories.personal_info")}
      >
        <ContactPersonalInfo />
      </AsideSection>

      <AsideSection
        title={translate("resources.contacts.field_categories.background_info")}
      >
        <ContactBackgroundInfo />
      </AsideSection>

      <NoraWriteAccess resource="contacts" action="edit">
        <AsideSection
          title={translate("resources.tags.name", { smart_count: 2 })}
        >
          <TagsListEdit />
        </AsideSection>

        <AsideSection
          title={translate("resources.tasks.name", { smart_count: 2 })}
        >
          <ReferenceManyField
            target="contact_id"
            reference="tasks"
            sort={{ field: "due_date", order: "ASC" }}
            perPage={1000}
          >
            <TasksIterator />
          </ReferenceManyField>
          <AddTask />
        </AsideSection>
      </NoraWriteAccess>

      {link !== "edit" && (
        <>
          <NoraWriteAccess resource="contacts" action="edit">
            <div className="mt-6 pt-6 border-t hidden sm:flex flex-col gap-2 items-start">
              <ExportVCardButton />
              <ContactMergeButton />
            </div>
          </NoraWriteAccess>
          <div className="mt-6 pt-6 border-t hidden sm:flex flex-col gap-2 items-start">
            <NoraDeleteButton resource="contacts" className="h-6 cursor-pointer hover:bg-destructive/10! text-destructive! border-destructive! focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40" size="sm" />
          </div>
        </>
      )}
    </div>
  );
};

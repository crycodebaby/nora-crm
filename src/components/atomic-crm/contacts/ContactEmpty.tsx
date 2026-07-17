import { useState } from "react";
import { CanAccess, useTranslate } from "ra-core";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";

import useAppBarHeight from "../misc/useAppBarHeight";
import { NoraCreateButton } from "../misc/NoraAccessActions";
import { NoraEmptyState } from "../misc/NoraEmptyState";
import { ContactImportButton } from "./ContactImportButton";
import { ContactCreateSheet } from "./ContactCreateSheet";

export const ContactEmpty = () => {
  const appbarHeight = useAppBarHeight();
  const isMobile = useIsMobile();
  const translate = useTranslate();
  const [createOpen, setCreateOpen] = useState(false);

  const createAction = (
    <CanAccess resource="contacts" action="create">
      {isMobile ? (
        <Button
          onClick={() => setCreateOpen(true)}
          variant="outline"
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          {translate("resources.contacts.action.new")}
        </Button>
      ) : (
        <>
          <NoraCreateButton
            resource="contacts"
            label="resources.contacts.action.new"
          />
          <ContactImportButton />
        </>
      )}
    </CanAccess>
  );

  return (
    <>
      <ContactCreateSheet open={createOpen} onOpenChange={setCreateOpen} />
      <div style={{ height: `calc(100dvh - ${appbarHeight}px)` }}>
        <NoraEmptyState
          title={translate("resources.contacts.empty.title")}
          description={translate("resources.contacts.empty.description")}
          action={createAction}
          className="h-full"
        />
      </div>
    </>
  );
};

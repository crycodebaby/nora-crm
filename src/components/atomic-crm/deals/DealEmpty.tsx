import { useGetList, useTranslate } from "ra-core";
import { useLocation, Link } from "react-router";
import { CanAccess } from "ra-core";
import { matchesNoraSubPath, noraCreatePath } from "../routing/noraRoutes";
import type { ReactNode } from "react";

import useAppBarHeight from "../misc/useAppBarHeight";
import { NoraCreateButton } from "../misc/NoraAccessActions";
import { NoraEmptyState } from "../misc/NoraEmptyState";
import { NoraPageLoading } from "../misc/NoraPageLoading";
import type { Contact } from "../types";
import { DealCreate } from "./DealCreate";

export const DealEmpty = ({ children }: { children?: ReactNode }) => {
  const translate = useTranslate();
  const location = useLocation();
  const matchCreate = matchesNoraSubPath("deals", "create", location.pathname);
  const appbarHeight = useAppBarHeight();

  // get Contact data
  const { data: contacts, isPending: contactsLoading } = useGetList<Contact>(
    "contacts",
    {
      pagination: { page: 1, perPage: 1 },
    },
  );

  if (contactsLoading) return <NoraPageLoading />;

  return (
    <div style={{ height: `calc(100dvh - ${appbarHeight}px)` }}>
      {contacts && contacts.length > 0 ? (
        <>
          <NoraEmptyState
            title={translate("resources.deals.empty.title")}
            description={translate("resources.deals.empty.description")}
            action={
              <NoraCreateButton
                resource="deals"
                label="resources.deals.action.create"
              />
            }
            className="h-full"
          />
          <DealCreate open={!!matchCreate} />
          {children}
        </>
      ) : (
        <NoraEmptyState
          title={translate("resources.deals.empty.title")}
          description={
            <>
              {translate("resources.contacts.empty.description")}
              <br />
              <CanAccess resource="contacts" action="create">
                <Link
                  to={noraCreatePath({ resource: "contacts", type: "create" })}
                  className="hover:underline"
                >
                  {translate("resources.contacts.action.add_first")}
                </Link>{" "}
              </CanAccess>
              {translate("resources.deals.empty.before_create")}
            </>
          }
          className="h-full"
        />
      )}
    </div>
  );
};

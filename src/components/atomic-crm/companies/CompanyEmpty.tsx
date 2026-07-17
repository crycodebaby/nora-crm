import { useTranslate } from "ra-core";

import useAppBarHeight from "../misc/useAppBarHeight";
import { NoraCreateButton } from "../misc/NoraAccessActions";
import { NoraEmptyState } from "../misc/NoraEmptyState";

export const CompanyEmpty = () => {
  const appbarHeight = useAppBarHeight();
  const translate = useTranslate();

  return (
    <div style={{ height: `calc(100dvh - ${appbarHeight}px)` }}>
      <NoraEmptyState
        title={translate("resources.companies.empty.title")}
        description={translate("resources.companies.empty.no_customers_yet", {
          _: translate("resources.companies.empty.description"),
        })}
        action={
          <NoraCreateButton
            resource="companies"
            label="resources.companies.action.create"
          />
        }
        className="h-full"
      />
    </div>
  );
};

import type { ComponentType, ReactElement, ReactNode } from "react";
import { createElement, isValidElement } from "react";
import {
  ResourceContextProvider,
  RestoreScrollPosition,
  useRouterProvider,
} from "ra-core";
import { LegacyPathRedirect } from "./LegacyPathRedirect";
import { NORA_RESOURCE_PATHS, type NoraRoutableResource } from "./noraRoutes";

type ResourceViews = {
  list?: ComponentType | ReactElement;
  create?: ComponentType | ReactElement;
  edit?: ComponentType | ReactElement;
  show?: ComponentType | ReactElement;
  children?: ReactNode;
};

export type NoraResourceAliasRoutesProps = {
  contacts: ResourceViews;
  companies: ResourceViews;
  deals: ResourceViews;
};

const getElement = (ElementOrComponent: ComponentType | ReactElement) => {
  if (isValidElement(ElementOrComponent)) {
    return ElementOrComponent;
  }
  const Element = ElementOrComponent as ComponentType;
  return createElement(Element);
};

/**
 * Returns German URL alias routes as direct <Route> elements.
 *
 * Must be spread inside <CustomRoutes> — React Router only accepts <Route> or
 * <Fragment> as children of <Routes>, not wrapper components.
 */
export const useNoraResourceAliasRoutes = ({
  contacts,
  companies,
  deals,
}: NoraResourceAliasRoutesProps) => {
  const { Route, Routes } = useRouterProvider();

  const createAliasRoute = (
    resource: NoraRoutableResource,
    views: ResourceViews,
  ) => {
    const { create, edit, list, show, children } = views;
    if (!create && !edit && !list && !show && !children) {
      return null;
    }

    const slug = NORA_RESOURCE_PATHS[resource];

    return (
      <Route
        key={`nora-${slug}`}
        path={`${slug}/*`}
        element={
          <ResourceContextProvider value={resource}>
            <Routes>
              {create && <Route path="create/*" element={getElement(create)} />}
              {show && <Route path=":id/show/*" element={getElement(show)} />}
              {edit && <Route path=":id/*" element={getElement(edit)} />}
              {list && (
                <Route
                  path="/*"
                  element={
                    <RestoreScrollPosition
                      storeKey={`${resource}.list.scrollPosition`}
                    >
                      {getElement(list)}
                    </RestoreScrollPosition>
                  }
                />
              )}
              {children}
            </Routes>
          </ResourceContextProvider>
        }
      />
    );
  };

  return [
    createAliasRoute("contacts", contacts),
    createAliasRoute("companies", companies),
    createAliasRoute("deals", deals),
    <Route
      key="legacy-contacts"
      path="contacts/*"
      element={<LegacyPathRedirect from="contacts" />}
    />,
    <Route
      key="legacy-companies"
      path="companies/*"
      element={<LegacyPathRedirect from="companies" />}
    />,
    <Route
      key="legacy-deals"
      path="deals/*"
      element={<LegacyPathRedirect from="deals" />}
    />,
  ].filter(Boolean);
};

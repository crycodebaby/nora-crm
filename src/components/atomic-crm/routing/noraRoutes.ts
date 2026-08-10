import type { Identifier } from "ra-core";
import { matchPath } from "react-router";

/** Internal react-admin resource name → German URL segment */
export const NORA_RESOURCE_PATHS = {
  contacts: "kontakte",
  companies: "kunden",
  deals: "vorgaenge",
} as const;

export type NoraRoutableResource = keyof typeof NORA_RESOURCE_PATHS;

const LEGACY_PATH_TO_RESOURCE: Record<string, NoraRoutableResource> = {
  contacts: "contacts",
  companies: "companies",
  deals: "deals",
};

export const isNoraRoutableResource = (
  resource: string,
): resource is NoraRoutableResource => resource in NORA_RESOURCE_PATHS;

export const getResourceSlug = (resource: string): string =>
  isNoraRoutableResource(resource) ? NORA_RESOURCE_PATHS[resource] : resource;

export type NoraPathType = "list" | "create" | "edit" | "show";

export type NoraCreatePathParams = {
  resource: string;
  type: NoraPathType;
  id?: Identifier;
};

/** Build a German user-facing path while keeping internal resource names unchanged. */
export const noraCreatePath = ({
  resource,
  type,
  id,
}: NoraCreatePathParams): string => {
  const slug = getResourceSlug(resource);

  switch (type) {
    case "list":
      return `/${slug}`;
    case "create":
      return `/${slug}/create`;
    case "edit":
      if (id == null) return `/${slug}`;
      return `/${slug}/${encodeURIComponent(String(id))}`;
    case "show":
      if (id == null) return `/${slug}`;
      return `/${slug}/${encodeURIComponent(String(id))}/show`;
    default:
      return `/${slug}`;
  }
};

/** Map legacy English URL segments to German paths (same suffix). */
export const translateLegacyPathname = (pathname: string): string | null => {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const legacyResource = segments[0];
  const resource = LEGACY_PATH_TO_RESOURCE[legacyResource];
  if (!resource) return null;

  const germanSegments = [getResourceSlug(resource), ...segments.slice(1)];
  return `/${germanSegments.join("/")}`;
};

export const matchesNoraResourcePath = (
  pathname: string,
  resource: NoraRoutableResource,
): boolean => {
  const slug = NORA_RESOURCE_PATHS[resource];
  return (
    pathname === `/${slug}` ||
    pathname.startsWith(`/${slug}/`) ||
    pathname === `/${resource}` ||
    pathname.startsWith(`/${resource}/`)
  );
};

export const getActiveNoraResource = (
  pathname: string,
): NoraRoutableResource | false => {
  for (const resource of Object.keys(
    NORA_RESOURCE_PATHS,
  ) as NoraRoutableResource[]) {
    if (matchesNoraResourcePath(pathname, resource)) {
      return resource;
    }
  }
  return false;
};

/** Match a sub-path for both legacy English and German URL segments. */
export const matchesNoraSubPath = (
  resource: NoraRoutableResource,
  subPath: string,
  pathname: string,
): boolean => {
  const slug = NORA_RESOURCE_PATHS[resource];
  return (
    matchPath(`/${resource}/${subPath}`, pathname) != null ||
    matchPath(`/${slug}/${subPath}`, pathname) != null
  );
};

/**
 * True when `id` is a real record id — never the create route segment.
 * Prevents getOne("deals", { id: "create" }) from dialog edit/show mounts.
 */
export const isNoraRecordId = (
  id: string | number | undefined | null,
): id is string | number => {
  if (id == null) return false;
  const value = String(id).trim();
  if (!value) return false;
  return value.toLowerCase() !== "create";
};

/** Match edit routes while excluding create and show. */
export const matchNoraEditPath = (
  resource: NoraRoutableResource,
  pathname: string,
) => {
  if (matchesNoraSubPath(resource, "create", pathname)) {
    return null;
  }
  const slug = NORA_RESOURCE_PATHS[resource];
  const showMatch =
    matchPath(`/${resource}/:id/show`, pathname) ??
    matchPath(`/${slug}/:id/show`, pathname);
  if (showMatch) {
    return null;
  }
  const editMatch =
    matchPath(`/${resource}/:id`, pathname) ??
    matchPath(`/${slug}/:id`, pathname);
  if (!editMatch || !isNoraRecordId(editMatch.params.id)) {
    return null;
  }
  return editMatch;
};

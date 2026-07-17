import type { Identifier } from "ra-core";

export type AccessRedirectTarget =
  | { type: "none" }
  | { type: "fallback"; path: string }
  | {
      type: "ra";
      action: "show" | "list";
      resource: string;
      id?: Identifier;
    };

/** Pure redirect resolution for edit/create guards (testable). */
export const getAccessRedirectTarget = ({
  canAccess,
  isPending,
  recordId,
  resource,
  redirectTarget = "show",
  fallbackPath,
}: {
  canAccess: boolean;
  isPending: boolean;
  recordId?: Identifier;
  resource: string;
  redirectTarget?: "show" | "list";
  fallbackPath?: string;
}): AccessRedirectTarget => {
  if (isPending || canAccess) {
    return { type: "none" };
  }

  if (fallbackPath) {
    return { type: "fallback", path: fallbackPath };
  }

  if (redirectTarget === "list" || recordId == null) {
    return { type: "ra", action: "list", resource };
  }

  return { type: "ra", action: "show", resource, id: recordId };
};

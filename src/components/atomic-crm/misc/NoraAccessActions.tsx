import type { ReactNode } from "react";
import { CanAccess, useCanAccess } from "ra-core";

import { BulkDeleteButton } from "@/components/admin/bulk-delete-button";
import { CreateButton } from "@/components/admin/create-button";
import { DeleteButton } from "@/components/admin/delete-button";
import { EditButton } from "@/components/admin/edit-button";

type NoraCreateButtonProps = {
  resource: string;
  label?: string;
};

export const NoraCreateButton = ({
  resource,
  label,
}: NoraCreateButtonProps) => (
  <CanAccess resource={resource} action="create">
    <CreateButton label={label} />
  </CanAccess>
);

type NoraLabeledButtonProps = {
  resource: string;
  label?: string;
  className?: string;
  size?: "default" | "sm" | "lg" | "icon";
};

export const NoraEditButton = ({ resource, label }: NoraLabeledButtonProps) => (
  <CanAccess resource={resource} action="edit">
    <EditButton label={label} />
  </CanAccess>
);

export const NoraDeleteButton = ({
  resource,
  label,
  className,
  size,
}: NoraLabeledButtonProps) => (
  <CanAccess resource={resource} action="delete">
    <DeleteButton label={label} className={className} size={size} />
  </CanAccess>
);

export const NoraBulkDeleteButton = ({ resource }: { resource: string }) => (
  <CanAccess resource={resource} action="delete">
    <BulkDeleteButton />
  </CanAccess>
);

type NoraWriteAccessProps = {
  resource: string;
  action?: "create" | "edit" | "delete";
  children: ReactNode;
};

/** Generic wrapper for write-gated UI fragments. */
export const NoraWriteAccess = ({
  resource,
  action = "edit",
  children,
}: NoraWriteAccessProps) => {
  const { canAccess, isPending } = useCanAccess({ resource, action });
  if (isPending || !canAccess) return null;
  return <>{children}</>;
};

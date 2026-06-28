import React from "react";
import { Plus } from "lucide-react";
import { Translate, useResourceContext } from "ra-core";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { useNoraAwareCreatePath } from "@/hooks/useNoraAwareCreatePath";

export type CreateButtonProps = {
  label?: string;
  resource?: string;
};

/**
 * Primary list action — navigates to the create page using German URL paths.
 */
export const CreateButton = ({
  label,
  resource: targetResource,
}: CreateButtonProps) => {
  const resource = useResourceContext();
  const createPath = useNoraAwareCreatePath();
  const link = createPath({
    resource: targetResource ?? resource ?? "",
    type: "create",
  });

  return (
    <Link
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap transition-colors",
        "nora-primary-action",
      )}
      to={link}
      onClick={stopPropagation}
    >
      <Plus className="h-4 w-4" />
      <Translate i18nKey={label ?? "ra.action.create"}>
        {label ?? "Create"}
      </Translate>
    </Link>
  );
};

const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

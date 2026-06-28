import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";

export interface TopToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export const TopToolbar = (inProps: TopToolbarProps) => {
  const { className, children, ...props } = inProps;

  return (
    <div
      className={cn(
        "flex flex-auto justify-end items-end gap-3 whitespace-nowrap flex-wrap",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export default TopToolbar;

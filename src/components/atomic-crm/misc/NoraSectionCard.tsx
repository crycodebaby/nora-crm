import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type NoraSectionCardProps = {
  title: string;
  children: ReactNode;
  className?: string;
};

export const NoraSectionCard = ({
  title,
  children,
  className,
}: NoraSectionCardProps) => (
  <section className={cn("nora-section-card", className)}>
    <h3 className="nora-section-title">{title}</h3>
    <div className="nora-section-body">{children}</div>
  </section>
);

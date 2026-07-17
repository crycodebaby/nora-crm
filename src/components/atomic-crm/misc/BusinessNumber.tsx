import { cn } from "@/lib/utils";

export type BusinessNumberKind = "customer" | "case" | "auto";
export type BusinessNumberSize = "sm" | "md" | "lg";

function detectKind(value: string): "customer" | "case" {
  if (value.startsWith("KD-")) {
    return "customer";
  }
  if (value.startsWith("VG-")) {
    return "case";
  }
  return "case";
}

/** Read-only display for KD-/VG- business numbers */
export const BusinessNumber = ({
  value,
  kind = "auto",
  size = "md",
  variant = "badge",
  className,
}: {
  value?: string | null;
  kind?: BusinessNumberKind;
  size?: BusinessNumberSize;
  variant?: "inline" | "badge";
  className?: string;
}) => {
  if (!value) return null;

  const resolvedKind = kind === "auto" ? detectKind(value) : kind;

  if (variant === "inline") {
    return (
      <span
        className={cn(
          "nora-business-id-inline font-mono tabular-nums tracking-wide text-foreground",
          size === "sm" && "text-sm",
          size === "md" && "text-[15px]",
          size === "lg" && "text-base font-semibold",
          className,
        )}
      >
        {value}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "nora-business-id-badge inline-flex w-fit max-w-full items-center rounded-md border font-mono font-semibold tabular-nums tracking-wide",
        resolvedKind === "customer"
          ? "nora-business-id-customer"
          : "nora-business-id-case",
        size === "sm" && "nora-business-id-sm",
        size === "md" && "nora-business-id-md",
        size === "lg" && "nora-business-id-lg",
        className,
      )}
    >
      {value}
    </span>
  );
};

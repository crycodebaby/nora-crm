import { ClipboardPlus } from "lucide-react";
import { CanAccess, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useQuickCapture } from "./QuickCaptureContext";

type QuickCaptureTriggerProps = {
  variant: "header" | "hotboard" | "mobile";
  className?: string;
};

export const QuickCaptureTrigger = ({
  variant,
  className,
}: QuickCaptureTriggerProps) => {
  const translate = useTranslate();
  const { openQuickCapture } = useQuickCapture();

  if (variant === "header") {
    return (
      <CanAccess resource="deals" action="create">
        <Button
          type="button"
          variant="outline"
          className={cn("nora-touch-target hidden md:inline-flex shrink-0", className)}
          onClick={openQuickCapture}
        >
          <ClipboardPlus className="size-4 mr-2" />
          {translate("crm.quick_capture.title")}
        </Button>
      </CanAccess>
    );
  }

  if (variant === "hotboard") {
    return (
      <CanAccess resource="deals" action="create">
        <Button
          type="button"
          className={cn("nora-primary-action nora-touch-target shrink-0", className)}
          onClick={openQuickCapture}
        >
          <ClipboardPlus className="size-4 mr-2" />
          {translate("crm.quick_capture.capture_new_inquiry")}
        </Button>
      </CanAccess>
    );
  }

  return (
    <CanAccess resource="deals" action="create">
      <button
      type="button"
      className={cn(
        "w-full text-left h-12 px-4 text-base hover:bg-accent",
        className,
      )}
      onClick={openQuickCapture}
    >
      {translate("crm.quick_capture.capture_new_inquiry")}
    </button>
    </CanAccess>
  );
};

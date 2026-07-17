import { useTranslate } from "ra-core";

import { cn } from "@/lib/utils";

import type { QuickCaptureStep } from "./quickCaptureDraft";

type QuickCaptureStepTabsProps = {
  current: QuickCaptureStep;
  onChange: (step: QuickCaptureStep) => void;
};

export const QuickCaptureStepTabs = ({
  current,
  onChange,
}: QuickCaptureStepTabsProps) => {
  const translate = useTranslate();

  const tabs: { step: QuickCaptureStep; label: string }[] = [
    {
      step: 1,
      label: translate("crm.quick_capture.step_labels.customer"),
    },
    {
      step: 2,
      label: translate("crm.quick_capture.step_labels.contact"),
    },
    {
      step: 3,
      label: translate("crm.quick_capture.step_labels.deal"),
    },
  ];

  return (
    <div
      className="flex gap-1.5 pt-2"
      role="tablist"
      aria-label={translate("crm.quick_capture.title")}
    >
      {tabs.map(({ step, label }) => {
        const active = step === current;
        return (
          <button
            key={step}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(step)}
            className={cn(
              "flex-1 min-w-0 rounded-md border px-2 py-2.5 text-xs sm:text-sm font-medium text-center transition-colors nora-touch-target",
              active &&
                "border-[var(--nora-brand)] bg-[var(--nora-brand-soft)] text-foreground",
              !active &&
                "border-border bg-background text-muted-foreground hover:bg-muted/50",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};

import { CalendarOff } from "lucide-react";
import { useTranslate } from "ra-core";

const isDemoMode = import.meta.env.VITE_IS_DEMO === "true";

export const GoogleCalendarDemoNotice = () => {
  const translate = useTranslate();

  if (!isDemoMode) {
    return null;
  }

  return (
    <p
      className="nora-muted text-xs max-w-3xl flex items-start gap-1.5"
      data-testid="google-calendar-demo-notice"
    >
      <CalendarOff className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
      <span>{translate("crm.calendar.demo_not_connected")}</span>
    </p>
  );
};

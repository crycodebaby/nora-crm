import { CalendarClock, RefreshCw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import { useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

import { NoraAccessGuard } from "../misc/NoraEditGuard";
import { NoraPageLoading } from "../misc/NoraPageLoading";
import { getSupabaseClient } from "../providers/supabase/supabase";
import { GOOGLE_CALENDAR_ADMIN_PATH } from "./googleCalendarAdminPath";
import { GoogleCalendarDemoNotice } from "./GoogleCalendarDemoNotice";

const isDemoMode = import.meta.env.VITE_IS_DEMO === "true";

type CalendarConnection = {
  id: string;
  calendar_id: string;
  calendar_name: string | null;
  google_account_email: string | null;
  status: string;
  last_sync_at: string | null;
  last_sync_error: string | null;
  connected_at: string | null;
};

type CalendarEventRow = {
  id: string;
  title_snapshot: string | null;
  is_all_day: boolean;
  starts_at: string | null;
  start_date: string | null;
  google_status: string | null;
};

const formatWhen = (event: CalendarEventRow): string => {
  if (event.is_all_day && event.start_date) {
    return event.start_date;
  }
  if (event.starts_at) {
    return new Date(event.starts_at).toLocaleString("de-DE");
  }
  return "—";
};

const GoogleCalendarAdminContent = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const [searchParams, setSearchParams] = useSearchParams();
  const [busy, setBusy] = useState<"connect" | "sync" | null>(null);

  const calendarStatus = searchParams.get("calendar");
  const calendarReason = searchParams.get("reason");

  const { data: connections, isPending: connectionsPending } =
    useGetList<CalendarConnection>("google_calendar_connections", {
      pagination: { page: 1, perPage: 5 },
      sort: { field: "updated_at", order: "DESC" },
    });

  const connection = connections?.[0] ?? null;
  const isConnected = connection?.status === "connected";

  const { data: events, isPending: eventsPending } =
    useGetList<CalendarEventRow>("google_calendar_events", {
      pagination: { page: 1, perPage: 10 },
      sort: { field: "starts_at", order: "ASC" },
      filter: { deleted_at: null },
    }, { enabled: isConnected && !isDemoMode });

  const statusLabel = useMemo(() => {
    if (!connection) {
      return translate("crm.calendar.admin.status_disconnected");
    }
    return translate(`crm.calendar.admin.status_${connection.status}`, {
      _: connection.status,
    });
  }, [connection, translate]);

  const clearOAuthParams = useCallback(() => {
    if (calendarStatus) {
      const next = new URLSearchParams(searchParams);
      next.delete("calendar");
      next.delete("reason");
      setSearchParams(next, { replace: true });
    }
  }, [calendarStatus, searchParams, setSearchParams]);

  const handleConnect = async () => {
    if (isDemoMode) {
      return;
    }
    setBusy("connect");
    try {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "calendar-connect-start",
        { method: "POST", body: {} },
      );
      if (error) {
        throw error;
      }
      const url = (data as { authorization_url?: string })?.authorization_url;
      if (!url) {
        throw new Error("missing authorization_url");
      }
      window.location.assign(url);
    } catch {
      notify(translate("crm.calendar.admin.connect_error"), { type: "error" });
      setBusy(null);
    }
  };

  const handleSync = async () => {
    if (isDemoMode) {
      return;
    }
    setBusy("sync");
    try {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "calendar-sync-manual",
        { method: "POST", body: {} },
      );
      if (error) {
        throw error;
      }
      const payload = data as { status?: string; summary?: Record<string, number> };
      if (payload.status === "ok" && payload.summary) {
        notify(
          translate("crm.calendar.admin.sync_success", {
            imported: payload.summary.imported ?? 0,
            updated: payload.summary.updated ?? 0,
          }),
          { type: "success" },
        );
      } else {
        notify(translate("crm.calendar.admin.sync_error"), { type: "error" });
      }
      refresh();
    } catch {
      notify(translate("crm.calendar.admin.sync_error"), { type: "error" });
    } finally {
      setBusy(null);
    }
  };

  if (connectionsPending) {
    return <NoraPageLoading variant="cards" className="min-h-[16rem]" />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl flex flex-col gap-5 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {translate("crm.calendar.admin.title")}
        </h1>
        <p className="nora-muted text-sm mt-1">
          {translate("crm.calendar.admin.subtitle")}
        </p>
      </div>

      {isDemoMode ? <GoogleCalendarDemoNotice /> : null}

      {calendarStatus === "connected" ? (
        <p className="text-sm text-green-700 dark:text-green-400">
          {translate("crm.calendar.admin.oauth_connected")}
        </p>
      ) : null}
      {calendarStatus === "error" ? (
        <p className="text-sm text-destructive">
          {translate("crm.calendar.admin.oauth_error", {
            reason: calendarReason ?? translate("crm.calendar.admin.unknown_error"),
          })}
        </p>
      ) : null}
      {(calendarStatus === "connected" || calendarStatus === "error") && (
        <Button variant="outline" size="sm" onClick={clearOAuthParams}>
          {translate("crm.calendar.admin.dismiss_status")}
        </Button>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            {translate("crm.calendar.admin.connection_card")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="font-medium">{translate("crm.calendar.admin.field_status")}: </span>
            {statusLabel}
          </p>
          {connection?.google_account_email ? (
            <p>
              <span className="font-medium">{translate("crm.calendar.admin.field_account")}: </span>
              {connection.google_account_email}
            </p>
          ) : null}
          {connection?.calendar_name ? (
            <p>
              <span className="font-medium">{translate("crm.calendar.admin.field_calendar")}: </span>
              {connection.calendar_name}
            </p>
          ) : null}
          {connection?.last_sync_at ? (
            <p>
              <span className="font-medium">{translate("crm.calendar.admin.field_last_sync")}: </span>
              {new Date(connection.last_sync_at).toLocaleString("de-DE")}
            </p>
          ) : null}
          {connection?.last_sync_error ? (
            <p className="text-destructive">
              <span className="font-medium">{translate("crm.calendar.admin.field_last_error")}: </span>
              {connection.last_sync_error}
            </p>
          ) : null}

          {!isDemoMode ? (
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                onClick={handleConnect}
                disabled={busy !== null || isConnected}
              >
                {busy === "connect" ? <Spinner className="mr-2 h-4 w-4" /> : null}
                {translate("crm.calendar.admin.connect_button")}
              </Button>
              <Button
                variant="secondary"
                onClick={handleSync}
                disabled={busy !== null || !isConnected}
              >
                {busy === "sync" ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
                {translate("crm.calendar.admin.sync_button")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isConnected && !isDemoMode ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {translate("crm.calendar.admin.recent_events")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {eventsPending ? (
              <Spinner className="h-5 w-5" />
            ) : (events?.length ?? 0) === 0 ? (
              <p className="nora-muted text-sm">
                {translate("crm.calendar.admin.no_cached_events")}
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {(events ?? []).map((event) => (
                  <li key={event.id} className="border-b border-border/60 pb-2 last:border-0">
                    <div className="font-medium">
                      {event.title_snapshot || translate("crm.calendar.admin.untitled_event")}
                    </div>
                    <div className="nora-muted text-xs">
                      {formatWhen(event)}
                      {event.google_status ? ` · ${event.google_status}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export const GoogleCalendarAdminPage = () => (
  <NoraAccessGuard resource="google_calendar_connections" action="list" fallbackPath="/">
    <GoogleCalendarAdminContent />
  </NoraAccessGuard>
);

GoogleCalendarAdminPage.path = GOOGLE_CALENDAR_ADMIN_PATH;

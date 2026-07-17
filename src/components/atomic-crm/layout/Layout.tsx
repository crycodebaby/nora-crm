import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useLocation } from "react-router";
import { Notification } from "@/components/admin/notification";
import { Error } from "@/components/admin/error";
import { cn } from "@/lib/utils";

import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { QuickCaptureProvider } from "../quickCapture/QuickCaptureContext";
import { NoraReadOnlyBanner } from "../misc/NoraReadOnlyBanner";
import { NoraPageLoading } from "../misc/NoraPageLoading";
import Header from "./Header";

const isDealsKanbanPath = (pathname: string) =>
  /^\/(deals|vorgaenge)(\/|$)/.test(pathname);

export const Layout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  const { pathname } = useLocation();
  const isDealsKanban = isDealsKanbanPath(pathname);

  return (
    <QuickCaptureProvider>
      <div data-testid="authenticated-app-shell">
        <Header />
        <main
          className={cn(
            "nora-page mx-auto pt-5 px-4 md:px-6 pb-6",
            isDealsKanban ? "max-w-none w-full" : "max-w-screen-xl",
          )}
          id="main-content"
        >
          <NoraReadOnlyBanner className="mb-4" />
          <ErrorBoundary FallbackComponent={Error}>
            <Suspense fallback={<NoraPageLoading variant="inline" />}>
              {children}
            </Suspense>
          </ErrorBoundary>
        </main>
        <Notification />
      </div>
    </QuickCaptureProvider>
  );
};

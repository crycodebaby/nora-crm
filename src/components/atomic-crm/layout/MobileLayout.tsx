import { Error } from "@/components/admin/error";
import { Notification } from "@/components/admin/notification";
import { Skeleton } from "@/components/ui/skeleton";
import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { QuickCaptureProvider } from "../quickCapture/QuickCaptureContext";
import { NoraNotificationOutlet } from "../notifications/NoraNotificationOutlet";
import { NoraUpdateEvent } from "../pwa/NoraUpdateEvent";
import { MobileNavigation } from "./MobileNavigation";

export const MobileLayout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  return (
    <QuickCaptureProvider>
      <div data-testid="authenticated-app-shell">
        <ErrorBoundary FallbackComponent={Error}>
          <Suspense fallback={<Skeleton className="h-12 w-12 rounded-full" />}>
            {children}
          </Suspense>
        </ErrorBoundary>
        <MobileNavigation />
        {/* The card stack positions itself above MobileNavigation (7B.2); the
            legacy toaster keeps its own offset for the unmigrated flows. */}
        <Notification mobileOffset={{ bottom: "72px" }} />
        <NoraNotificationOutlet />
        <NoraUpdateEvent />
      </div>
    </QuickCaptureProvider>
  );
};

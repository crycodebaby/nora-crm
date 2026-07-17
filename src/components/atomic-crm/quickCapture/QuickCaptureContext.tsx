import { useMemo, useState, type ReactNode } from "react";

import { QuickCaptureDialog } from "./QuickCaptureDialog";
import { QuickCaptureContext } from "./quickCaptureContextValue";

export const QuickCaptureProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);

  const value = useMemo(
    () => ({
      open,
      openQuickCapture: () => setOpen(true),
      closeQuickCapture: () => setOpen(false),
    }),
    [open],
  );

  return (
    <QuickCaptureContext.Provider value={value}>
      {children}
      <QuickCaptureDialog open={open} onOpenChange={setOpen} />
    </QuickCaptureContext.Provider>
  );
};

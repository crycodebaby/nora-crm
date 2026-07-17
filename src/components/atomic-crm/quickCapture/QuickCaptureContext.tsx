import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { QuickCaptureDialog } from "./QuickCaptureDialog";

type QuickCaptureContextValue = {
  open: boolean;
  openQuickCapture: () => void;
  closeQuickCapture: () => void;
};

const QuickCaptureContext = createContext<QuickCaptureContextValue | null>(null);

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

export const useQuickCapture = () => {
  const context = useContext(QuickCaptureContext);
  if (!context) {
    throw new Error("useQuickCapture must be used within QuickCaptureProvider");
  }
  return context;
};

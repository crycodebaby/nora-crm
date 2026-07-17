import { createContext } from "react";

export type QuickCaptureContextValue = {
  open: boolean;
  openQuickCapture: () => void;
  closeQuickCapture: () => void;
};

export const QuickCaptureContext =
  createContext<QuickCaptureContextValue | null>(null);

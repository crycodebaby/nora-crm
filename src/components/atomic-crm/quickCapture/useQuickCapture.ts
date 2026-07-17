import { useContext } from "react";

import { QuickCaptureContext } from "./quickCaptureContextValue";

export const useQuickCapture = () => {
  const context = useContext(QuickCaptureContext);
  if (!context) {
    throw new Error("useQuickCapture must be used within QuickCaptureProvider");
  }
  return context;
};

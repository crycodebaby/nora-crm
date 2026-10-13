import { useCallback, useState } from "react";

export type LiveMessage = { text: string; nonce: number };

/**
 * Two live channels (docs/nora/26 §13.5): `polite` (role="status") and
 * `alert`. Each message carries a nonce so the same text said twice is
 * re-rendered as a new node and announced again.
 */
export const useLiveAnnouncer = () => {
  const [polite, setPolite] = useState<LiveMessage | null>(null);
  const [alert, setAlert] = useState<LiveMessage | null>(null);
  const say = useCallback((channel: "polite" | "alert", text: string) => {
    const message = { text, nonce: Date.now() + Math.random() };
    if (channel === "polite") setPolite(message);
    else setAlert(message);
  }, []);
  return { polite, alert, say };
};

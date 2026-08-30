import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import App from "./App.tsx";

// Entwicklerwerkzeug fuer das Update-Systemereignis (PWA-1C.1). Der Demo-Modus
// hat einen eigenen Einstiegspunkt, deshalb steht derselbe Block wie in
// `src/main.tsx` auch hier — ohne ihn gaebe es das Panel nur unter `npm run
// dev`, nicht unter `npm run dev:demo`.
//
// Ausschliesslich im Dev-Server: `import.meta.env.DEV` wird beim Bauen statisch
// durch `false` ersetzt, Rollup entfernt den toten Zweig samt dem dynamischen
// Import. Der Demo-Modus registriert selbst keinen Service Worker (kein
// VitePWA-Plugin in `vite.demo.config.ts`) — das Werkzeug faelscht die
// Registrierung deshalb erst beim Klick.
if (import.meta.env.DEV) {
  void import("../src/components/atomic-crm/pwa/devUpdateTrigger").then(
    ({ mountUpdateDevTrigger }) => mountUpdateDevTrigger(),
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { noraRegisterSW } from "./components/atomic-crm/pwa/pwaRegistration";
import { pwaUpdateStore } from "./components/atomic-crm/pwa/pwaUpdateStore";

// Letztes Sicherheitsnetz, nicht der Regelweg. Seit PWA-1B bleibt ein neuer
// Service Worker WAITING, solange der Benutzer nicht aktualisiert — der
// Precache des laufenden Builds bleibt damit intakt und ein Lazy Chunk kann
// normalerweise gar nicht mehr fehlen. Greift dieser Handler trotzdem (z. B.
// weil der Cache vom Browser verdraengt wurde), ist ein Reload immer noch
// besser als eine kaputte Ansicht. Die sessionStorage-Sperre verhindert eine
// Endlosschleife. Siehe https://vite.dev/guide/build.html#load-error-handling
window.addEventListener("vite:preloadError", () => {
  const key = "chunk-reload";
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, "1");
    window.location.reload();
  }
});

// Der Service Worker gehoert zum Fenster, nicht zur angemeldeten Sitzung:
// Nora rendert seine Layouts erst nach dem Login, eine Registrierung weiter
// unten im Baum wuerde die Login-Seite und abgemeldete Nutzer auslassen.
pwaUpdateStore.start(noraRegisterSW);

// Entwicklerwerkzeug fuer das Update-Systemereignis (PWA-1C.1). Ausschliesslich
// im Dev-Server: `import.meta.env.DEV` wird beim Bauen statisch durch `false`
// ersetzt, Rollup entfernt den toten Zweig samt dem dynamischen Import — aus
// `devUpdateTrigger` landet dadurch kein Byte im Production-Bundle. Bewusst
// dynamisch und nicht statisch importiert: ein statischer Import stuende am
// Modulanfang und haenge davon ab, dass Tree-Shaking ihn erkennt.
if (import.meta.env.DEV) {
  void import("./components/atomic-crm/pwa/devUpdateTrigger").then(
    ({ mountUpdateDevTrigger }) => mountUpdateDevTrigger(),
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

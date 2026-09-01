/**
 * Die Abschlussbestaetigung eines Updates ueber den Reload hinweg
 * (Welle PWA Completion Acknowledgement, 2026-09-01).
 *
 * Ein erfolgreiches Update endet immer mit einem Reload — entweder laedt
 * der Client aus `virtual:pwa-register` beim `controlling`-Ereignis selbst
 * neu, oder Nora tut es (Fallback nach dem Commit, „Nora neu laden"). Das
 * Dokument, das den Erfolg gesehen hat, ist danach weg. Damit die frisch
 * geladene Version trotzdem „Aktualisierung abgeschlossen" sagen kann,
 * traegt genau ein Bit den Erfolg ueber den Reload: ein Eintrag im
 * `sessionStorage`.
 *
 * **Warum `sessionStorage`.** Er ist an den Tab gebunden: er ueberlebt genau
 * den Reload, laeuft nie in einen anderen Tab und stirbt mit dem Tab. Kein
 * `localStorage` (wuerde in jedem spaeter geoeffneten Tab feuern), kein
 * Query-Parameter (Router, Bookmarks), kein Cross-Tab-Messaging. Dieselbe
 * Wahl wie `chunk-reload` in `src/main.tsx`.
 *
 * **Wann geschrieben wird — und nur dann.** `markUpdateCompleted()` faellt
 * an genau den Stellen, an denen Nora WEISS, dass die neue Version dieses
 * Dokument uebernommen hat oder bereits aktiv ist:
 *
 *   1. `controllerchange` im Store — der einzige belastbare Erfolgsbeweis
 *      einer Uebernahme (`pwaUpdateStore.ts`). Synchron im Listener, der
 *      vor dem Workbox-Listener registriert ist: das Bit steht, bevor der
 *      Client `window.location.reload()` aufruft.
 *   2. Noras eigener Reload (`reloadPage` in `NoraUpdateEvent.tsx`) — der
 *      Fallback nach dem Commit und der Klick auf „Nora neu laden" im
 *      Zustand `reloadRequired`, den die Browser-Fakten belegt haben.
 *
 * Nie bei `failed`, nie bei „Gleich bereit", nie bei „Spaeter", nie bei
 * einem gewoehnlichen Reload (F5): ohne einen dieser beiden Wege gibt es das
 * Bit nicht, und die naechste Version zeigt nichts.
 *
 * **Genau einmal.** `consumeUpdateCompletion()` liest das Bit beim ersten
 * Aufruf eines Dokuments, loescht es sofort aus dem Speicher und merkt sich
 * das Ergebnis im Modul. Jeder weitere Aufruf in derselben Dokument-
 * Lebensdauer (StrictMode-Doppelaufruf, Layout-Wechsel Mobile/Desktop,
 * Remount nach Login) antwortet gleich — bis `acknowledgeUpdateCompletion()`
 * die Anzeige quittiert. Ein zweiter Reload findet nichts mehr vor.
 *
 * Kein Zustand des Update-Lifecycles: der State Contract V2 in
 * `pwaUpdateStore.ts` bleibt unveraendert, das Bit ist ein reiner
 * Uebergabepunkt zwischen zwei Dokument-Lebensdauern.
 */

export const UPDATE_COMPLETED_STORAGE_KEY = "nora.pwa.updateCompleted";

/** Ergebnis der ersten Lesung dieses Dokuments; `undefined` = noch nicht gelesen. */
let pending: boolean | undefined;

const readStorage = (): Storage | null => {
  // `sessionStorage` kann fehlen oder beim Zugriff werfen (Privatmodus mit
  // gesperrtem Speicher, Site-Daten blockiert). Ohne Speicher gibt es
  // schlicht keine Bestaetigung — nie einen Fehler beim Update.
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

/** Vor dem Reload: dieses Dokument wurde von der neuen Version uebernommen. */
export const markUpdateCompleted = (): void => {
  try {
    readStorage()?.setItem(UPDATE_COMPLETED_STORAGE_KEY, "1");
  } catch {
    // Speicher voll oder gesperrt: dann eben keine Bestaetigung.
  }
};

/**
 * Nach dem Reload: liegt eine Abschlussbestaetigung vor? Liest und loescht
 * das Bit beim ersten Aufruf, antwortet danach aus dem Modulspeicher.
 */
export const consumeUpdateCompletion = (): boolean => {
  if (pending === undefined) {
    let found = false;
    try {
      const storage = readStorage();
      found = storage?.getItem(UPDATE_COMPLETED_STORAGE_KEY) === "1";
      if (found) storage?.removeItem(UPDATE_COMPLETED_STORAGE_KEY);
    } catch {
      found = false;
    }
    pending = found;
  }
  return pending;
};

/** Die Bestaetigung wurde gezeigt (oder ist verworfen): kein zweites Mal. */
export const acknowledgeUpdateCompletion = (): void => {
  pending = false;
};

/**
 * Nur fuer Tests: den Modulspeicher vergessen, als begaenne ein neues
 * Dokument. Im echten Betrieb erledigt das der Reload.
 */
export const resetUpdateCompletion = (): void => {
  pending = undefined;
};

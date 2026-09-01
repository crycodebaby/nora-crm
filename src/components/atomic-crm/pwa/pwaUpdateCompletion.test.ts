import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  UPDATE_COMPLETED_STORAGE_KEY,
  acknowledgeUpdateCompletion,
  consumeUpdateCompletion,
  markUpdateCompleted,
  resetUpdateCompletion,
} from "./pwaUpdateCompletion";

/**
 * Der Uebergabepunkt zwischen zwei Dokument-Lebensdauern — gegen den echten
 * `sessionStorage` des Test-Browsers. `resetUpdateCompletion()` spielt den
 * Reload: der Modulspeicher vergisst, der Storage bleibt, wie er ist.
 */
describe("pwaUpdateCompletion", () => {
  beforeEach(() => {
    sessionStorage.removeItem(UPDATE_COMPLETED_STORAGE_KEY);
    resetUpdateCompletion();
  });

  afterEach(() => {
    sessionStorage.removeItem(UPDATE_COMPLETED_STORAGE_KEY);
    resetUpdateCompletion();
  });

  it("findet ohne vorheriges Update nichts — ein gewoehnlicher Reload bestaetigt nichts", () => {
    expect(consumeUpdateCompletion()).toBe(false);
    expect(sessionStorage.getItem(UPDATE_COMPLETED_STORAGE_KEY)).toBeNull();
  });

  it("traegt den Abschluss ueber den Reload und liefert ihn genau einmal", () => {
    markUpdateCompleted();
    expect(sessionStorage.getItem(UPDATE_COMPLETED_STORAGE_KEY)).toBe("1");

    // Das naechste Dokument.
    resetUpdateCompletion();
    expect(consumeUpdateCompletion()).toBe(true);
    // Sofort aus dem Speicher: ein weiterer Reload findet nichts mehr.
    expect(sessionStorage.getItem(UPDATE_COMPLETED_STORAGE_KEY)).toBeNull();

    // Innerhalb derselben Dokument-Lebensdauer antwortet jeder Aufruf gleich
    // (StrictMode-Doppelaufruf, Layout-Wechsel, Remount nach Login).
    expect(consumeUpdateCompletion()).toBe(true);
    expect(consumeUpdateCompletion()).toBe(true);

    // Das uebernaechste Dokument: nichts.
    resetUpdateCompletion();
    expect(consumeUpdateCompletion()).toBe(false);
  });

  it("kommt nach der Quittung nicht wieder", () => {
    markUpdateCompleted();
    resetUpdateCompletion();
    expect(consumeUpdateCompletion()).toBe(true);

    acknowledgeUpdateCompletion();
    expect(consumeUpdateCompletion()).toBe(false);
    expect(sessionStorage.getItem(UPDATE_COMPLETED_STORAGE_KEY)).toBeNull();
  });

  it("ignoriert fremde Werte im Speicher", () => {
    sessionStorage.setItem(UPDATE_COMPLETED_STORAGE_KEY, "yes");
    expect(consumeUpdateCompletion()).toBe(false);
    // Ein unbekannter Wert wird nicht angeruehrt.
    expect(sessionStorage.getItem(UPDATE_COMPLETED_STORAGE_KEY)).toBe("yes");
  });
});

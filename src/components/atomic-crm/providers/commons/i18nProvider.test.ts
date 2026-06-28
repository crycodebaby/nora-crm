import { afterEach, describe, expect, it, vi } from "vitest";
import { getInitialLocale, i18nProvider } from "./i18nProvider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("i18nProvider", () => {
  it("registers de, en and fr locales", () => {
    expect(i18nProvider.getLocales?.()).toEqual([
      { locale: "de", name: "Deutsch" },
      { locale: "en", name: "English" },
      { locale: "fr", name: "Français" },
    ]);
  });

  it("translates the language key in german", async () => {
    await i18nProvider.changeLocale("de");

    expect(i18nProvider.translate("crm.language")).toBe("Sprache");
  });

  it("translates the language key in french", async () => {
    await i18nProvider.changeLocale("fr");

    expect(i18nProvider.translate("crm.language")).toBe("Langue");
  });

  it("falls back to english for unknown locales", async () => {
    await i18nProvider.changeLocale("es");

    expect(i18nProvider.translate("crm.language")).toBe("Language");
  });

  it("uses customized password reset overrides for de, en and fr", async () => {
    await i18nProvider.changeLocale("de");
    expect(i18nProvider.translate("ra-supabase.auth.password_reset")).toBe(
      "Prüfen Sie Ihre E-Mails auf eine Nachricht zum Zurücksetzen des Passworts.",
    );

    await i18nProvider.changeLocale("en");
    expect(i18nProvider.translate("ra-supabase.auth.password_reset")).toBe(
      "Check your emails for a Reset Password message.",
    );

    await i18nProvider.changeLocale("fr");
    expect(i18nProvider.translate("ra-supabase.auth.password_reset")).toBe(
      "Consultez vos emails pour trouver le message de reinitialisation du mot de passe.",
    );
  });

  it("translates german crm keys", async () => {
    await i18nProvider.changeLocale("de");

    expect(i18nProvider.translate("resources.deals.empty.title")).toBe(
      "Keine Vorgänge gefunden",
    );
    expect(i18nProvider.translate("crm.auth.welcome_title")).toBe(
      "Willkommen bei Nora CRM",
    );
    expect(i18nProvider.translate("ra.page.dashboard")).toBe("Übersicht");
    expect(i18nProvider.translate("ra.action.export")).toBe(
      "Daten herunterladen",
    );
  });

  it("translates recently added fr crm keys", async () => {
    await i18nProvider.changeLocale("fr");

    expect(i18nProvider.translate("resources.deals.empty.title")).toBe(
      "Aucune affaire trouvée",
    );
  });

  it("uses browser french locale when available", () => {
    vi.stubGlobal("navigator", {
      language: "fr-FR",
      languages: ["fr-FR", "en-US"],
    });

    expect(getInitialLocale()).toBe("fr");
  });

  it("uses browser english locale when available", () => {
    vi.stubGlobal("navigator", {
      language: "en-US",
      languages: ["en-US", "de-DE"],
    });

    expect(getInitialLocale()).toBe("en");
  });

  it("falls back to german when browser locale is unsupported", () => {
    vi.stubGlobal("navigator", {
      language: "es-ES",
      languages: ["es-ES", "pt-BR"],
    });

    expect(getInitialLocale()).toBe("de");
  });
});

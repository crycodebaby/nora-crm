import type { ConfigurationContextValue } from "./ConfigurationContext";

export const defaultDarkModeLogo = "./logos/nora-monogram-dark.png";
export const defaultLightModeLogo = "./logos/nora-monogram-light.png";

/** Betreiber-Marke (Ergart Gruppe) – Grafik aus public/logos */
export const defaultOperatorDarkLogo = "./logos/logo_atomic_crm_dark.svg";
export const defaultOperatorLightLogo = "./logos/logo_atomic_crm_light.svg";
export const defaultOperatorName = "Ergart Gruppe";

export const defaultCurrency = "EUR";

export const defaultTitle = "Nora CRM";

export const defaultCompanySectors = [
  { value: "privatkunde", label: "Privatkunde" },
  { value: "hausverwaltung", label: "Hausverwaltung" },
  { value: "gewerbekunde", label: "Gewerbekunde" },
  { value: "bestandskunde", label: "Bestandskunde" },
  { value: "neukunde", label: "Neukunde" },
  { value: "lieferant-hersteller", label: "Lieferant / Hersteller" },
  { value: "sonstiges", label: "Sonstiges" },
];

/** Nora Vorgangsstatus – technische IDs bleiben stabil, Labels sind deutsch. */
export const defaultDealStages = [
  { value: "neue-anfrage", label: "Neue Anfrage" },
  { value: "kontaktiert", label: "Kontaktiert" },
  { value: "termin-vereinbart", label: "Termin vereinbart" },
  { value: "aufmass-geplant", label: "Aufmaß geplant" },
  { value: "aufmass-erledigt", label: "Aufmaß erledigt" },
  { value: "in-kalkulation", label: "In Kalkulation" },
  { value: "wartet-auf-hersteller", label: "Wartet auf Hersteller" },
  { value: "angebot-gesendet", label: "Angebot gesendet" },
  { value: "nachfassen", label: "Nachfassen" },
  { value: "angenommen", label: "Angenommen" },
  { value: "abgelehnt", label: "Abgelehnt" },
  { value: "abgeschlossen", label: "Abgeschlossen" },
];

export const defaultDealPipelineStatuses = [
  "angenommen",
  "abgelehnt",
  "abgeschlossen",
];

export const defaultDealCategories = [
  { value: "hausmeisterdienst", label: "Hausmeisterdienst" },
  { value: "fensterservice", label: "Fensterservice" },
  { value: "reparatur", label: "Reparatur" },
  { value: "wartung", label: "Wartung" },
  { value: "sonstiges", label: "Sonstiges" },
];

export const defaultNoteStatuses = [
  { value: "cold", label: "Kalt", color: "#7dbde8" },
  { value: "warm", label: "Warm", color: "#e8cb7d" },
  { value: "hot", label: "Heiß", color: "#e88b7d" },
  { value: "in-contract", label: "Im Auftrag", color: "#a4e87d" },
];

export const defaultTaskTypes = [
  { value: "rueckruf", label: "Rückruf" },
  { value: "besichtigung", label: "Besichtigung" },
  { value: "aufmass", label: "Aufmaß" },
  { value: "herstelleranfrage", label: "Herstelleranfrage" },
  { value: "angebot-erstellen", label: "Angebot erstellen" },
  { value: "angebot-nachfassen", label: "Angebot nachfassen" },
  { value: "termin-vereinbaren", label: "Termin vereinbaren" },
  { value: "dokumentation", label: "Dokumentation" },
];

export const defaultConfiguration: ConfigurationContextValue = {
  companySectors: defaultCompanySectors,
  currency: defaultCurrency,
  dealCategories: defaultDealCategories,
  dealPipelineStatuses: defaultDealPipelineStatuses,
  dealStages: defaultDealStages,
  noteStatuses: defaultNoteStatuses,
  taskTypes: defaultTaskTypes,
  title: defaultTitle,
  darkModeLogo: defaultDarkModeLogo,
  lightModeLogo: defaultLightModeLogo,
};

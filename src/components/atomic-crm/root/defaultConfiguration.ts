import type { ConfigurationContextValue } from "./ConfigurationContext";

export const defaultDarkModeLogo = "./logos/nora-monogram-dark.png";
export const defaultLightModeLogo = "./logos/nora-monogram-light.png";

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

export const defaultDealStages = [
  { value: "anfrage", label: "Anfrage" },
  { value: "angebot", label: "Angebot" },
  { value: "beauftragt", label: "Beauftragt" },
  { value: "in-arbeit", label: "In Arbeit" },
  { value: "abgeschlossen", label: "Abgeschlossen" },
  { value: "abgelehnt", label: "Abgelehnt" },
];

export const defaultDealPipelineStatuses = ["abgeschlossen"];

export const defaultDealCategories = [
  { value: "hausmeisterdienst", label: "Hausmeisterdienst" },
  { value: "fensterservice", label: "Fensterservice" },
  { value: "reparatur", label: "Reparatur" },
  { value: "wartung", label: "Wartung" },
  { value: "sonstiges", label: "Sonstiges" },
];

export const defaultNoteStatuses = [
  { value: "cold", label: "Cold", color: "#7dbde8" },
  { value: "warm", label: "Warm", color: "#e8cb7d" },
  { value: "hot", label: "Hot", color: "#e88b7d" },
  { value: "in-contract", label: "In Contract", color: "#a4e87d" },
];

export const defaultTaskTypes = [
  { value: "none", label: "None" },
  { value: "email", label: "Email" },
  { value: "demo", label: "Demo" },
  { value: "lunch", label: "Lunch" },
  { value: "meeting", label: "Meeting" },
  { value: "follow-up", label: "Follow-up" },
  { value: "thank-you", label: "Thank you" },
  { value: "ship", label: "Ship" },
  { value: "call", label: "Call" },
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

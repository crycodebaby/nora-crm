/**
 * Nora Application Backbone – Operation Catalog (Foundation Wave 2).
 *
 * Strict typed catalog of business operations. Messages are German product copy
 * for later Feedback UI — Wave 2 does not render them yet.
 */

import type { OperationResourceType, OperationType } from "./operationContext";

export type OperationCatalogEntry = {
  operationType: OperationType;
  resourceType: OperationResourceType;
  pendingMessage: string;
  successMessage: string;
  errorMessage: string;
};

/**
 * Catalog keys currently activated for Wave 2.
 * `deal.assign` is prepared but not forced as a separate mutation
 * (assignee changes travel with deal.update in the same form save).
 */
export type CatalogOperationType =
  | "deal.update"
  | "deal.assign"
  | "customer.update"
  | "customer.createWithContact"
  | "contact.update"
  | "contact.setPrimary"
  | "contact.convertToCustomer"
  | "quickCapture.createCase"
  | "quickCapture.createTask"
  | "employee.change_login_email"
  | "employee.offboard";

export const OPERATION_CATALOG: {
  readonly [K in CatalogOperationType]: OperationCatalogEntry & {
    operationType: K;
  };
} = {
  "deal.update": {
    operationType: "deal.update",
    resourceType: "deals",
    pendingMessage: "Vorgang wird gespeichert …",
    successMessage: "Vorgang wurde gespeichert.",
    errorMessage: "Vorgang konnte nicht gespeichert werden.",
  },
  "deal.assign": {
    operationType: "deal.assign",
    resourceType: "deals",
    pendingMessage: "Zuständigkeit wird aktualisiert …",
    successMessage: "Zuständigkeit wurde aktualisiert.",
    errorMessage: "Zuständigkeit konnte nicht aktualisiert werden.",
  },
  "customer.update": {
    operationType: "customer.update",
    resourceType: "companies",
    pendingMessage: "Kunde wird gespeichert …",
    successMessage: "Kunde wurde gespeichert.",
    errorMessage: "Kunde konnte nicht gespeichert werden.",
  },
  "contact.update": {
    operationType: "contact.update",
    resourceType: "contacts",
    pendingMessage: "Kontakt wird gespeichert …",
    successMessage: "Kontakt wurde gespeichert.",
    errorMessage: "Kontakt konnte nicht gespeichert werden.",
  },
  "customer.createWithContact": {
    operationType: "customer.createWithContact",
    resourceType: "companies",
    pendingMessage: "Kunde wird angelegt …",
    successMessage: "Kunde wurde angelegt.",
    errorMessage: "Kunde konnte nicht angelegt werden.",
  },
  "contact.setPrimary": {
    operationType: "contact.setPrimary",
    resourceType: "contacts",
    pendingMessage: "Hauptansprechpartner wird geändert …",
    successMessage: "Hauptansprechpartner wurde geändert.",
    errorMessage: "Hauptansprechpartner konnte nicht geändert werden.",
  },
  "contact.convertToCustomer": {
    operationType: "contact.convertToCustomer",
    resourceType: "companies",
    pendingMessage: "Kundenakte wird angelegt …",
    successMessage: "Kundenakte wurde angelegt.",
    errorMessage: "Kundenakte konnte nicht angelegt werden.",
  },
  "quickCapture.createCase": {
    operationType: "quickCapture.createCase",
    resourceType: "deals",
    pendingMessage: "Schnellerfassung wird gespeichert …",
    successMessage: "Schnellerfassung wurde gespeichert.",
    errorMessage: "Schnellerfassung konnte nicht gespeichert werden.",
  },
  "quickCapture.createTask": {
    operationType: "quickCapture.createTask",
    resourceType: "tasks",
    pendingMessage: "Aufgabe wird angelegt …",
    successMessage: "Aufgabe wurde angelegt.",
    errorMessage: "Aufgabe konnte nicht angelegt werden.",
  },
  "employee.change_login_email": {
    operationType: "employee.change_login_email",
    resourceType: "sales",
    pendingMessage: "Anmeldeadresse wird geändert …",
    successMessage: "Anmeldeadresse wurde geändert.",
    errorMessage: "Anmeldeadresse konnte nicht geändert werden.",
  },
  "employee.offboard": {
    operationType: "employee.offboard",
    resourceType: "sales",
    pendingMessage: "Nora-Zugang wird beendet …",
    successMessage: "Nora-Zugang wurde beendet.",
    errorMessage: "Nora-Zugang konnte nicht beendet werden.",
  },
} as const;

export const getOperationCatalogEntry = (
  operationType: CatalogOperationType,
): OperationCatalogEntry => OPERATION_CATALOG[operationType];

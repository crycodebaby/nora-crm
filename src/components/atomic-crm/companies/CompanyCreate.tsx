import { CustomerCreateForm } from "./CustomerCreateForm";

/**
 * /kunden/create — Referenzimplementierung der Customer & Contact Workflow
 * Wave. Siehe CustomerCreateForm.tsx für die atomare Kunde+Ansprechpartner-
 * Erfassung (RPC create_customer_with_contact statt reinem
 * dataProvider.create).
 */
export const CompanyCreate = () => <CustomerCreateForm />;

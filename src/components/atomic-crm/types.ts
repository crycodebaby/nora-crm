import type { Identifier, RaRecord } from "ra-core";
import type { ComponentType } from "react";

import type {
  COMPANY_CREATED,
  CONTACT_CREATED,
  CONTACT_NOTE_CREATED,
  DEAL_CREATED,
  DEAL_NOTE_CREATED,
} from "./consts";

export type SignUpData = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
};

export type NoraRole = "admin" | "office" | "viewer";

export type SalesFormData = {
  avatar?: string;
  email: string;
  password?: string;
  first_name: string;
  last_name: string;
  role: NoraRole;
  /** @deprecated Spiegel von role=admin — nur Kompatibilität */
  administrator: boolean;
  disabled: boolean;
};

export type SalesDirectory = {
  first_name: string;
  last_name: string;
  avatar?: RAFile;
} & Pick<RaRecord, "id">;

export type Sale = {
  first_name: string;
  last_name: string;
  role: NoraRole;
  administrator: boolean;
  avatar?: RAFile;
  disabled?: boolean;
  user_id: string;

  /**
   * This is a copy of the user's email, to make it easier to handle by react admin
   * DO NOT UPDATE this field directly, it should be updated by the backend
   */
  email: string;

  /**
   * This is used by the fake rest provider to store the password
   * DO NOT USE this field in your code besides the fake rest provider
   * @deprecated
   */
  password?: string;
} & Pick<RaRecord, "id">;

/**
 * Kundenart – treibt den Create-/Edit-Formularmodus:
 * "business" deckt Unternehmen, Selbstständige, Hausverwaltungen etc. ab,
 * "individual" ist die Privatperson als Kunde.
 * Siehe docs/nora/06-decision-log.md (Customer & Contact Workflow Wave).
 */
export type CustomerKind = "business" | "individual";

/**
 * Generalisiertes Link-Modell für companies.links_jsonb / contacts.links_jsonb.
 * Ersetzt die LinkedIn-only-Validierung; linkedin_url/website/context_links
 * bleiben als deprecated Legacy-Spalten bestehen (Datenerhalt), sind aber
 * nicht mehr die UI-Quelle.
 */
export type LinkType =
  | "website"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "google"
  | "portal"
  | "other";

export type LinkAndType = {
  url: string;
  type: LinkType;
  label?: string;
};

export type Company = {
  name: string;
  logo: RAFile;
  sector: string;
  size: 1 | 10 | 50 | 250 | 500;
  /** @deprecated UI-Quelle ist links_jsonb (type "linkedin"). Feld bleibt für Bestandsdaten. */
  linkedin_url: string;
  /** @deprecated UI-Quelle ist links_jsonb (type "website"). Feld bleibt für Bestandsdaten. */
  website: string;
  /** @deprecated UI-Quelle ist phone_jsonb (type "Central"). Feld bleibt für Bestandsdaten. */
  phone_number: string;
  address: string;
  zipcode: string;
  city: string;
  state_abbr: string;
  sales_id?: Identifier;
  created_at: string;
  description: string;
  revenue: string;
  tax_identifier: string;
  country: string;
  /** @deprecated UI-Quelle ist links_jsonb (type "other"). Feld bleibt für Bestandsdaten. */
  context_links?: string[];
  nb_contacts?: number;
  nb_deals?: number;
  customer_number: string;
  customer_kind: CustomerKind;
  links_jsonb: LinkAndType[];
  email_jsonb: EmailAndType[];
  phone_jsonb: PhoneNumberAndType[];
} & Pick<RaRecord, "id">;

export type EmailAndType = {
  email: string;
  type: "Work" | "Home" | "Other";
};

export type PhoneNumberAndType = {
  number: string;
  type: "Work" | "Home" | "Other" | "Mobile" | "Central" | "Direct";
};

export type Contact = {
  first_name: string;
  last_name: string;
  title: string;
  company_id?: Identifier | null;
  email_jsonb: EmailAndType[];
  avatar?: Partial<RAFile>;
  /** @deprecated UI-Quelle ist links_jsonb (type "linkedin"). Feld bleibt für Bestandsdaten. */
  linkedin_url?: string | null;
  first_seen: string;
  last_seen: string;
  has_newsletter: boolean;
  tags: number[];
  gender: string;
  sales_id?: Identifier;
  status: string;
  background: string;
  phone_jsonb: PhoneNumberAndType[];
  links_jsonb: LinkAndType[];
  /** Hauptansprechpartner des zugeordneten Kunden — max. 1 pro company_id (DB-Constraint). */
  is_primary: boolean;
  nb_tasks?: number;
  company_name?: string;
} & Pick<RaRecord, "id">;

export type ContactNote = {
  contact_id: Identifier;
  text: string;
  date: string;
  sales_id: Identifier;
  status: string;
  attachments?: AttachmentNote[];
} & Pick<RaRecord, "id">;

export type Deal = {
  name: string;
  company_id: Identifier;
  contact_ids: Identifier[];
  category: string;
  stage: string;
  description: string;
  amount: number;
  created_at: string;
  updated_at: string;
  archived_at?: string;
  expected_closing_date: string;
  sales_id: Identifier;
  index: number;
  case_number: string;
} & Pick<RaRecord, "id">;

export type DealNote = {
  deal_id: Identifier;
  text: string;
  date: string;
  sales_id: Identifier;
  attachments?: AttachmentNote[];

  // This is defined for compatibility with `ContactNote`
  status?: undefined;
} & Pick<RaRecord, "id">;

export type Tag = {
  id: number;
  name: string;
  color: string;
};

export type Task = {
  /** Historical contact context — nullable, a task may be company-only. */
  contact_id?: Identifier | null;
  /** Historical customer context — nullable, a task may be contact-only.
   * At least one of company_id/contact_id is always set (DB CHECK constraint).
   * Set once (derived server-side from contact_id's company, or explicit)
   * and never re-synced automatically if the contact later changes company. */
  company_id?: Identifier | null;
  type: string;
  text: string;
  due_date: string;
  done_date?: string | null;
  sales_id?: Identifier;
} & Pick<RaRecord, "id">;

export type ActivityCompanyCreated = {
  type: typeof COMPANY_CREATED;
  company_id: Identifier;
  company: Company;
  sales_id: Identifier;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityContactCreated = {
  type: typeof CONTACT_CREATED;
  company_id: Identifier;
  sales_id?: Identifier;
  contact: Contact;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityContactNoteCreated = {
  type: typeof CONTACT_NOTE_CREATED;
  sales_id?: Identifier;
  contactNote: ContactNote;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityDealCreated = {
  type: typeof DEAL_CREATED;
  company_id: Identifier;
  sales_id?: Identifier;
  deal: Deal;
  date: string;
};

export type ActivityDealNoteCreated = {
  type: typeof DEAL_NOTE_CREATED;
  sales_id?: Identifier;
  dealNote: DealNote;
  date: string;
};

export type Activity = RaRecord &
  (
    | ActivityCompanyCreated
    | ActivityContactCreated
    | ActivityContactNoteCreated
    | ActivityDealCreated
    | ActivityDealNoteCreated
  );

export interface RAFile {
  src: string;
  title: string;
  path?: string;
  rawFile: File;
  type?: string;
}

export type AttachmentNote = RAFile;

export interface LabeledValue {
  value: string;
  label: string;
}

export type DealStage = LabeledValue;

export interface NoteStatus extends LabeledValue {
  color: string;
}

export interface ContactGender {
  value: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export type {
  AuditEvent,
  ChecklistRun,
  ChecklistRunItem,
  ChecklistRunStatus,
  ChecklistTemplate,
  ChecklistTemplateItem,
  SavedTextSnippet,
  SavedTextSnippetKind,
  ServiceAreaCode,
} from "./types/checklists";

export { FENS_PRODUCTION_RELEASE_TEMPLATE_CODE } from "./types/checklists";

export type {
  StartChecklistRunFromTemplateArgs,
  StartChecklistRunFromTemplateResult,
} from "./types/checklists";

export { START_CHECKLIST_RUN_FROM_TEMPLATE_RPC } from "./types/checklists";

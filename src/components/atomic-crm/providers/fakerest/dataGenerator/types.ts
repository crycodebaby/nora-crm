import type {
  Company,
  Contact,
  ContactNote,
  Deal,
  DealNote,
  Sale,
  SalesDirectory,
  SalesIdentity,
  Tag,
  Task,
} from "../../../types";
import type { ConfigurationContextValue } from "../../../root/ConfigurationContext";

export interface Db {
  companies: Company[];
  contacts: Contact[];
  contact_notes: ContactNote[];
  deals: Deal[];
  deal_notes: DealNote[];
  sales: Sale[];
  sales_directory: SalesDirectory[];
  sales_identities: SalesIdentity[];
  tags: Tag[];
  tasks: Task[];
  configuration: Array<{ id: number; config: ConfigurationContextValue }>;
}

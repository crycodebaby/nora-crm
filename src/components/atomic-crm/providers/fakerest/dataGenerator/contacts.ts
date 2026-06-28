import type { Db } from "./types";
import { generateNoraContacts } from "./noraDemoSeed";

export const generateContacts = (db: Db) =>
  generateNoraContacts(db.companies);

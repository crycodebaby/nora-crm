import type { Db } from "./types";
import { generateNoraContactNotes } from "./noraDemoSeed";

export const generateContactNotes = (db: Db) =>
  generateNoraContactNotes(db.contacts);

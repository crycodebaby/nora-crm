import type { Db } from "./types";
import { generateNoraDealNotes } from "./noraDemoSeed";

export const generateDealNotes = (db: Db) => generateNoraDealNotes(db.deals);

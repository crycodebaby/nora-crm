import type { Db } from "./types";
import { generateNoraTasks } from "./noraDemoSeed";

export const generateTasks = (db: Db) => generateNoraTasks(db.contacts);

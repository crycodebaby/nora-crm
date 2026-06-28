import type { Db } from "./types";
import { generateNoraCompanies } from "./noraDemoSeed";

export const generateCompanies = (_db: Db) => generateNoraCompanies();

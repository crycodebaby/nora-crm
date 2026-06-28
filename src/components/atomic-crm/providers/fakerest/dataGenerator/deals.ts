import type { Db } from "./types";
import { generateNoraDeals } from "./noraDemoSeed";

export const generateDeals = (_db: Db) => generateNoraDeals();

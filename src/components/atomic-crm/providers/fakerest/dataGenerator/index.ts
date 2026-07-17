import { defaultConfiguration } from "../../../root/defaultConfiguration";
import { generateCompanies } from "./companies";
import { generateContactNotes } from "./contactNotes";
import { generateContacts } from "./contacts";
import { generateDealNotes } from "./dealNotes";
import { generateDeals } from "./deals";
import { finalizeNoraCounts } from "./noraDemoSeed";
import { generateSales } from "./sales";
import { generateTags } from "./tags";
import { generateTasks } from "./tasks";
import { initNumberCountersFromRecords } from "../../../misc/numbering";
import type { Db } from "./types";

export default (): Db => {
  const db = {} as Db;
  db.sales = generateSales(db);
  db.sales_directory = db.sales
    .filter((s) => !s.disabled)
    .map(({ id, first_name, last_name, avatar }) => ({
      id,
      first_name,
      last_name,
      avatar,
    }));
  db.tags = generateTags(db);
  db.companies = generateCompanies(db);
  db.contacts = generateContacts(db);
  db.contact_notes = generateContactNotes(db);
  db.deals = generateDeals(db);
  db.deal_notes = generateDealNotes(db);
  db.tasks = generateTasks(db);
  db.configuration = [
    {
      id: 1,
      config: defaultConfiguration,
    },
  ];
  finalizeNoraCounts(db);
  initNumberCountersFromRecords(db.companies, db.deals);

  return db;
};

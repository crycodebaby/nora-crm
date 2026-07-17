import { add, subDays } from "date-fns";

import { assignCaseNumbers, assignCustomerNumbers } from "../../../misc/numbering";
import { defaultDealStages } from "../../../root/defaultConfiguration";
import type {
  Company,
  Contact,
  ContactNote,
  Deal,
  DealNote,
  RAFile,
  Task,
} from "../../../types";
import type { Db } from "./types";
import {
  DUesseldorf_COMPANY_SEEDS,
  DUesseldorf_CONTACT_NOTE_SEEDS,
  DUesseldorf_CONTACT_SEEDS,
  DUesseldorf_DEAL_NOTE_SEEDS,
  DUesseldorf_DEAL_SEEDS,
  DUesseldorf_TASK_SEEDS,
} from "./noraDuesseldorfSeedData";

/** Demo-Benutzerin (sales_id 0) – siehe authProvider / generateSales */
export const NORA_DEMO_SALES_ID = 0;

const iso = (date: Date) => date.toISOString();
const dateOnly = (date: Date) => date.toISOString().split("T")[0];

const placeholderLogo = (title: string): RAFile =>
  ({
    title,
    src: "./logos/nora-monogram-light.png",
  }) as RAFile;

export const generateNoraCompanies = (): Required<Company>[] => {
  const companies = DUesseldorf_COMPANY_SEEDS.map((seed) => ({
    id: seed.id,
    name: seed.name,
    logo: placeholderLogo(seed.name),
    sector: seed.sector,
    size: seed.size,
    linkedin_url: "",
    website: seed.website ?? "",
    phone_number: seed.phone_number,
    address: seed.address,
    zipcode: seed.zipcode,
    city: seed.city,
    state_abbr: "NW",
    country: "Deutschland",
    nb_contacts: 0,
    nb_deals: 0,
    sales_id: NORA_DEMO_SALES_ID,
    created_at: iso(subDays(new Date(), seed.createdDaysAgo)),
    description: seed.description,
    revenue: "—",
    tax_identifier: "",
    context_links: [],
  }));

  return assignCustomerNumbers(companies) as Required<Company>[];
};

export const generateNoraContacts = (
  companies: Company[],
): Required<Contact>[] => {
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const seen = subDays(new Date(), 14).toISOString();

  return DUesseldorf_CONTACT_SEEDS.map((seed) => {
    const company = companyById.get(seed.company_id);
    return {
      id: seed.id,
      first_name: seed.first_name,
      last_name: seed.last_name,
      gender: seed.gender,
      title: seed.title,
      company_id: seed.company_id,
      company_name: company?.name ?? "",
      email_jsonb: seed.email
        ? [{ email: seed.email, type: "Work" as const }]
        : [],
      phone_jsonb: [{ number: seed.phone, type: "Work" as const }],
      background: seed.background,
      avatar: {},
      first_seen: seen,
      last_seen: iso(subDays(new Date(), 1)),
      has_newsletter: false,
      status: seed.status,
      tags: seed.tags,
      sales_id: NORA_DEMO_SALES_ID,
      nb_tasks: 0,
      linkedin_url: null,
    };
  });
};

export const generateNoraDeals = (): Deal[] => {
  const deals = DUesseldorf_DEAL_SEEDS.map((seed) => ({
    id: seed.id,
    name: seed.name,
    company_id: seed.company_id,
    contact_ids: seed.contact_ids,
    category: seed.category,
    stage: seed.stage,
    description: seed.description,
    amount: seed.amountEur,
    created_at: iso(subDays(new Date(), seed.createdDaysAgo)),
    updated_at: iso(subDays(new Date(), seed.updatedDaysAgo)),
    expected_closing_date: dateOnly(
      add(new Date(), { days: seed.followUpDaysFromNow }),
    ),
    sales_id: NORA_DEMO_SALES_ID,
    index: 0,
  }));

  const withCaseNumbers = assignCaseNumbers(deals);

  defaultDealStages.forEach((stage) => {
    withCaseNumbers
      .filter((deal) => deal.stage === stage.value)
      .forEach((deal, index) => {
        withCaseNumbers[deal.id].index = index;
      });
  });

  return withCaseNumbers;
};

export const generateNoraTasks = (contacts: Contact[]): Task[] => {
  const taskCounts = new Map<string | number, number>();

  const tasks = DUesseldorf_TASK_SEEDS.map((seed) => {
    taskCounts.set(
      seed.contact_id,
      (taskCounts.get(seed.contact_id) ?? 0) + 1,
    );
    return {
      id: seed.id,
      contact_id: seed.contact_id,
      type: seed.type,
      text: seed.text,
      due_date: iso(
        seed.done
          ? subDays(new Date(), 1)
          : add(new Date(), { days: seed.dueDaysFromNow }),
      ),
      done_date: seed.done ? iso(subDays(new Date(), 1)) : undefined,
      sales_id: NORA_DEMO_SALES_ID,
    };
  });

  for (const contact of contacts) {
    contact.nb_tasks = taskCounts.get(contact.id) ?? 0;
  }

  return tasks;
};

export const generateNoraContactNotes = (
  contacts: Contact[],
): ContactNote[] => {
  const notes: ContactNote[] = [];

  DUesseldorf_CONTACT_NOTE_SEEDS.forEach((seed, id) => {
    const date = subDays(new Date(), seed.daysAgo);
    notes.push({
      id,
      contact_id: seed.contact_id,
      text: seed.text,
      date: iso(date),
      sales_id: NORA_DEMO_SALES_ID,
      status: seed.status,
    });

    const contact = contacts.find((c) => c.id === seed.contact_id);
    if (contact && new Date(date) > new Date(contact.last_seen)) {
      contact.last_seen = iso(date);
    }
    if (contact) {
      contact.status = seed.status;
    }
  });

  return notes;
};

export const generateNoraDealNotes = (_deals: Deal[]): DealNote[] =>
  DUesseldorf_DEAL_NOTE_SEEDS.map((seed, id) => ({
    id,
    deal_id: seed.deal_id,
    text: seed.text,
    date: iso(subDays(new Date(), seed.daysAgo)),
    sales_id: NORA_DEMO_SALES_ID,
  }));

/** Aktualisiert nb_contacts / nb_deals anhand der generierten Daten */
export const finalizeNoraCounts = (db: Db) => {
  db.companies.forEach((c) => {
    c.nb_contacts = db.contacts.filter((ct) => ct.company_id === c.id).length;
    c.nb_deals = db.deals.filter((d) => d.company_id === c.id).length;
  });
};

import { add, subDays } from "date-fns";

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
import { assignCustomerNumbers, assignCaseNumbers } from "../../../misc/numbering";

/** Demo-Benutzerin (sales_id 0) – siehe authProvider / generateSales */
export const NORA_DEMO_SALES_ID = 0;

const iso = (date: Date) => date.toISOString();
const dateOnly = (date: Date) => date.toISOString().split("T")[0];

const placeholderLogo = (title: string): RAFile => ({
  title,
  src: "./logos/nora-monogram-light.png",
} as RAFile);

export const generateNoraCompanies = (): Required<Company>[] => {
  const created = subDays(new Date(), 120);
  const companies = [
    {
      id: 0,
      name: "Familie Müller",
      logo: placeholderLogo("Familie Müller"),
      sector: "privatkunde",
      size: 1,
      linkedin_url: "",
      website: "",
      phone_number: "+49 681 1234567",
      address: "Dudweilerstraße 42",
      zipcode: "66111",
      city: "Saarbrücken",
      state_abbr: "SL",
      country: "Deutschland",
      nb_contacts: 1,
      nb_deals: 2,
      sales_id: NORA_DEMO_SALES_ID,
      created_at: iso(created),
      description:
        "Privatkunde mit defektem Fenstergriff im Wohnzimmer. Erstkontakt per Telefon.",
      revenue: "—",
      tax_identifier: "",
      context_links: [],
    },
    {
      id: 1,
      name: "Wohnungsbau Saar GmbH",
      logo: placeholderLogo("Wohnungsbau Saar"),
      sector: "hausverwaltung",
      size: 50,
      linkedin_url: "",
      website: "https://www.wohnungsbau-saar.de",
      phone_number: "+49 681 9876543",
      address: "St. Johanner Straße 88",
      zipcode: "66111",
      city: "Saarbrücken",
      state_abbr: "SL",
      country: "Deutschland",
      nb_contacts: 2,
      nb_deals: 2,
      sales_id: NORA_DEMO_SALES_ID,
      created_at: iso(subDays(created, 10)),
      description:
        "Hausverwaltung mit Mehrfamilienhaus in Dudweiler. Haustür schließt nicht richtig.",
      revenue: "2 Mio. €",
      tax_identifier: "DE123456789",
      context_links: [],
    },
    {
      id: 2,
      name: "Autohaus Schneider",
      logo: placeholderLogo("Autohaus Schneider"),
      sector: "gewerbekunde",
      size: 10,
      linkedin_url: "",
      website: "https://www.autohaus-schneider-saar.de",
      phone_number: "+49 681 5551234",
      address: "Industriestraße 15",
      zipcode: "66121",
      city: "Saarbrücken",
      state_abbr: "SL",
      country: "Deutschland",
      nb_contacts: 1,
      nb_deals: 1,
      sales_id: NORA_DEMO_SALES_ID,
      created_at: iso(subDays(created, 20)),
      description:
        "Gewerbekunde mit Showroom-Fenstern. Regelmäßige Wartung der Fensterbeschläge.",
      revenue: "800.000 €",
      tax_identifier: "DE987654321",
      context_links: [],
    },
    {
      id: 3,
      name: "Immobilien Hoffmann",
      logo: placeholderLogo("Immobilien Hoffmann"),
      sector: "bestandskunde",
      size: 10,
      linkedin_url: "",
      website: "https://www.immobilien-hoffmann.de",
      phone_number: "+49 6831 441122",
      address: "Hauptstraße 7",
      zipcode: "66424",
      city: "Homburg",
      state_abbr: "SL",
      country: "Deutschland",
      nb_contacts: 1,
      nb_deals: 2,
      sales_id: NORA_DEMO_SALES_ID,
      created_at: iso(subDays(created, 45)),
      description:
        "Bestandskunde mit mehreren Objekten. Offenes Angebot für Fensterbeschläge.",
      revenue: "1,2 Mio. €",
      tax_identifier: "DE112233445",
      context_links: [],
    },
    {
      id: 4,
      name: "Restaurant Zum Brunnen",
      logo: placeholderLogo("Restaurant Zum Brunnen"),
      sector: "neukunde",
      size: 1,
      linkedin_url: "",
      website: "",
      phone_number: "+49 6841 778899",
      address: "Marktplatz 3",
      zipcode: "66440",
      city: "Blieskastel",
      state_abbr: "SL",
      country: "Deutschland",
      nb_contacts: 1,
      nb_deals: 1,
      sales_id: NORA_DEMO_SALES_ID,
      created_at: iso(subDays(created, 5)),
      description: "Neukunde mit Anfrage zur Reparatur eines Schaufenstergriffs.",
      revenue: "—",
      tax_identifier: "",
      context_links: [],
    },
    {
      id: 5,
      name: "Roto Frank Fensterbeschläge",
      logo: placeholderLogo("Roto Frank"),
      sector: "lieferant-hersteller",
      size: 250,
      linkedin_url: "",
      website: "https://www.roto-frank.com",
      phone_number: "+49 7931 2140",
      address: "Vor dem Kreuzberg 2",
      zipcode: "97980",
      city: "Bad Mergentheim",
      state_abbr: "BW",
      country: "Deutschland",
      nb_contacts: 1,
      nb_deals: 0,
      sales_id: NORA_DEMO_SALES_ID,
      created_at: iso(subDays(created, 200)),
      description:
        "Lieferant und Hersteller für Fensterbeschläge. Ansprechpartner für Ersatzteile.",
      revenue: "—",
      tax_identifier: "",
      context_links: [],
    },
    {
      id: 6,
      name: "Gemeinde Blieskastel",
      logo: placeholderLogo("Gemeinde Blieskastel"),
      sector: "sonstiges",
      size: 50,
      linkedin_url: "",
      website: "https://www.blieskastel.de",
      phone_number: "+49 6842 1010",
      address: "Schlossberg 1",
      zipcode: "66440",
      city: "Blieskastel",
      state_abbr: "SL",
      country: "Deutschland",
      nb_contacts: 1,
      nb_deals: 1,
      sales_id: NORA_DEMO_SALES_ID,
      created_at: iso(subDays(created, 90)),
      description: "Öffentlicher Auftraggeber für Hausmeister- und Fensterdienste.",
      revenue: "—",
      tax_identifier: "",
      context_links: [],
    },
    {
      id: 7,
      name: "Vonovia Regional Saar",
      logo: placeholderLogo("Vonovia Regional"),
      sector: "hausverwaltung",
      size: 250,
      linkedin_url: "",
      website: "https://www.vonovia.de",
      phone_number: "+49 681 700800",
      address: "Kaiserstraße 100",
      zipcode: "66113",
      city: "Saarbrücken",
      state_abbr: "SL",
      country: "Deutschland",
      nb_contacts: 1,
      nb_deals: 1,
      sales_id: NORA_DEMO_SALES_ID,
      created_at: iso(subDays(created, 60)),
      description:
        "Große Hausverwaltung mit Wartungsvertrag für Hausmeisterservice.",
      revenue: "—",
      tax_identifier: "",
      context_links: [],
    },
  ];
  return assignCustomerNumbers(companies) as Required<Company>[];
};

export const generateNoraContacts = (
  companies: Company[],
): Required<Contact>[] => {
  const company = (id: number) => companies[id]!;
  const seen = subDays(new Date(), 14).toISOString();

  return [
    {
      id: 0,
      first_name: "Sabine",
      last_name: "Müller",
      gender: "female",
      title: "Eigentümerin",
      company_id: 0,
      company_name: company(0).name,
      email_jsonb: [
        { email: "s.mueller@email.de", type: "Home" },
      ],
      phone_jsonb: [
        { number: "+49 170 1234567", type: "Home" },
      ],
      background:
        "Meldete defekten Fenstergriff im Wohnzimmer. Bevorzugt Termine nachmittags.",
      avatar: {},
      first_seen: seen,
      last_seen: iso(subDays(new Date(), 1)),
      has_newsletter: false,
      status: "hot",
      tags: [0, 1],
      sales_id: NORA_DEMO_SALES_ID,
      nb_tasks: 2,
      linkedin_url: null,
    },
    {
      id: 1,
      first_name: "Thomas",
      last_name: "Klein",
      gender: "male",
      title: "Objektleiter",
      company_id: 1,
      company_name: company(1).name,
      email_jsonb: [
        { email: "t.klein@wohnungsbau-saar.de", type: "Work" },
      ],
      phone_jsonb: [
        { number: "+49 681 9876543", type: "Work" },
      ],
      background:
        "Zuständig für MFH Dudweiler. Haustür schließt nicht richtig – dringend.",
      avatar: {},
      first_seen: iso(subDays(new Date(), 30)),
      last_seen: iso(subDays(new Date(), 2)),
      has_newsletter: false,
      status: "hot",
      tags: [1, 2],
      sales_id: NORA_DEMO_SALES_ID,
      nb_tasks: 2,
      linkedin_url: null,
    },
    {
      id: 2,
      first_name: "Andrea",
      last_name: "Schmitt",
      gender: "female",
      title: "Verwaltungsbeauftragte",
      company_id: 1,
      company_name: company(1).name,
      email_jsonb: [
        { email: "a.schmitt@wohnungsbau-saar.de", type: "Work" },
      ],
      phone_jsonb: [
        { number: "+49 681 9876544", type: "Work" },
      ],
      background: "Erstkontakt für neue Anfragen der Wohnungsbau Saar GmbH.",
      avatar: {},
      first_seen: iso(subDays(new Date(), 60)),
      last_seen: iso(subDays(new Date(), 10)),
      has_newsletter: false,
      status: "warm",
      tags: [2],
      sales_id: NORA_DEMO_SALES_ID,
      nb_tasks: 0,
      linkedin_url: null,
    },
    {
      id: 3,
      first_name: "Markus",
      last_name: "Schneider",
      gender: "male",
      title: "Geschäftsführer",
      company_id: 2,
      company_name: company(2).name,
      email_jsonb: [
        { email: "m.schneider@autohaus-schneider-saar.de", type: "Work" },
      ],
      phone_jsonb: [
        { number: "+49 681 5551234", type: "Work" },
      ],
      background: "Jährliche Wartung der Fensterbeschläge im Showroom.",
      avatar: {},
      first_seen: iso(subDays(new Date(), 45)),
      last_seen: iso(subDays(new Date(), 5)),
      has_newsletter: true,
      status: "warm",
      tags: [0, 4],
      sales_id: NORA_DEMO_SALES_ID,
      nb_tasks: 1,
      linkedin_url: null,
    },
    {
      id: 4,
      first_name: "Petra",
      last_name: "Hoffmann",
      gender: "female",
      title: "Geschäftsführerin",
      company_id: 3,
      company_name: company(3).name,
      email_jsonb: [
        { email: "p.hoffmann@immobilien-hoffmann.de", type: "Work" },
      ],
      phone_jsonb: [
        { number: "+49 6831 441122", type: "Work" },
      ],
      background:
        "Bestandskundin mit mehreren Objekten. Angebot für Fensterbeschläge offen.",
      avatar: {},
      first_seen: iso(subDays(new Date(), 90)),
      last_seen: iso(subDays(new Date(), 3)),
      has_newsletter: true,
      status: "in-contract",
      tags: [4, 3],
      sales_id: NORA_DEMO_SALES_ID,
      nb_tasks: 2,
      linkedin_url: null,
    },
    {
      id: 5,
      first_name: "Günter",
      last_name: "Brunn",
      gender: "male",
      title: "Inhaber",
      company_id: 4,
      company_name: company(4).name,
      email_jsonb: [
        { email: "info@zum-brunnen.de", type: "Work" },
      ],
      phone_jsonb: [
        { number: "+49 6841 778899", type: "Work" },
      ],
      background: "Neukunde – Schaufenstergriff defekt, Preisvergleich.",
      avatar: {},
      first_seen: iso(subDays(new Date(), 7)),
      last_seen: iso(subDays(new Date(), 7)),
      has_newsletter: false,
      status: "cold",
      tags: [],
      sales_id: NORA_DEMO_SALES_ID,
      nb_tasks: 0,
      linkedin_url: null,
    },
    {
      id: 6,
      first_name: "Stefan",
      last_name: "Frank",
      gender: "male",
      title: "Außendienst",
      company_id: 5,
      company_name: company(5).name,
      email_jsonb: [
        { email: "s.frank@roto-frank.com", type: "Work" },
      ],
      phone_jsonb: [
        { number: "+49 7931 214200", type: "Work" },
      ],
      background: "Ansprechpartner für Ersatzteile und Herstelleranfragen.",
      avatar: {},
      first_seen: iso(subDays(new Date(), 180)),
      last_seen: iso(subDays(new Date(), 4)),
      has_newsletter: false,
      status: "warm",
      tags: [],
      sales_id: NORA_DEMO_SALES_ID,
      nb_tasks: 1,
      linkedin_url: null,
    },
    {
      id: 7,
      first_name: "Claudia",
      last_name: "Berg",
      gender: "female",
      title: "Sachbearbeitung",
      company_id: 6,
      company_name: company(6).name,
      email_jsonb: [
        { email: "c.berg@blieskastel.de", type: "Work" },
      ],
      phone_jsonb: [
        { number: "+49 6842 101120", type: "Work" },
      ],
      background: "Öffentliche Ausschreibung Hausmeisterdienst abgeschlossen.",
      avatar: {},
      first_seen: iso(subDays(new Date(), 100)),
      last_seen: iso(subDays(new Date(), 20)),
      has_newsletter: false,
      status: "in-contract",
      tags: [2],
      sales_id: NORA_DEMO_SALES_ID,
      nb_tasks: 1,
      linkedin_url: null,
    },
    {
      id: 8,
      first_name: "Julia",
      last_name: "Wagner",
      gender: "female",
      title: "Objektbetreuerin",
      company_id: 7,
      company_name: company(7).name,
      email_jsonb: [
        { email: "j.wagner@vonovia.de", type: "Work" },
      ],
      phone_jsonb: [
        { number: "+49 681 700801", type: "Work" },
      ],
      background: "Wartungsvertrag Hausmeisterservice für Objekt Saarbrücken.",
      avatar: {},
      first_seen: iso(subDays(new Date(), 55)),
      last_seen: iso(subDays(new Date(), 6)),
      has_newsletter: true,
      status: "warm",
      tags: [2, 4],
      sales_id: NORA_DEMO_SALES_ID,
      nb_tasks: 1,
      linkedin_url: null,
    },
    {
      id: 9,
      first_name: "Klaus",
      last_name: "Weber",
      gender: "male",
      title: "Eigentümer",
      company_id: 0,
      company_name: company(0).name,
      email_jsonb: [
        { email: "k.weber@email.de", type: "Home" },
      ],
      phone_jsonb: [
        { number: "+49 170 9876543", type: "Home" },
      ],
      background: "Aufmaß für neues Fensterelement im Dachgeschoss geplant.",
      avatar: {},
      first_seen: iso(subDays(new Date(), 20)),
      last_seen: iso(subDays(new Date(), 2)),
      has_newsletter: false,
      status: "warm",
      tags: [0],
      sales_id: NORA_DEMO_SALES_ID,
      nb_tasks: 1,
      linkedin_url: null,
    },
  ];
};

type DealSeed = Omit<Deal, "id" | "index" | "case_number">;

const dealSeeds: DealSeed[] = [
  {
    name: "Fenstergriff Wohnzimmer defekt",
    company_id: 0,
    contact_ids: [0],
    category: "reparatur",
    stage: "neue-anfrage",
    description:
      "Fenstergriff im Wohnzimmer lässt sich nicht mehr verriegeln. Privatkunde Familie Müller, Saarbrücken-Dudweiler.",
    amount: 28000,
    created_at: iso(subDays(new Date(), 3)),
    updated_at: iso(subDays(new Date(), 1)),
    expected_closing_date: dateOnly(add(new Date(), { days: 14 })),
    sales_id: NORA_DEMO_SALES_ID,
  },
  {
    name: "Haustür Mehrfamilienhaus schließt nicht richtig",
    company_id: 1,
    contact_ids: [1],
    category: "reparatur",
    stage: "kontaktiert",
    description:
      "Haustür im MFH Dudweiler schließt nicht richtig. Hausverwaltung Wohnungsbau Saar – Besichtigung nötig.",
    amount: 145000,
    created_at: iso(subDays(new Date(), 12)),
    updated_at: iso(subDays(new Date(), 2)),
    expected_closing_date: dateOnly(add(new Date(), { days: 10 })),
    sales_id: NORA_DEMO_SALES_ID,
  },
  {
    name: "Aufmaß für neues Fensterelement",
    company_id: 0,
    contact_ids: [9],
    category: "fensterservice",
    stage: "termin-vereinbart",
    description:
      "Aufmaß für neues Fensterelement im Dachgeschoss. Termin mit Herrn Weber vereinbart.",
    amount: 320000,
    created_at: iso(subDays(new Date(), 18)),
    updated_at: iso(subDays(new Date(), 2)),
    expected_closing_date: dateOnly(add(new Date(), { days: 7 })),
    sales_id: NORA_DEMO_SALES_ID,
  },
  {
    name: "Fensterbeschläge Gewerbeobjekt – Wartung",
    company_id: 2,
    contact_ids: [3],
    category: "wartung",
    stage: "aufmass-geplant",
    description:
      "Jährliche Wartung der Fensterbeschläge im Autohaus-Showroom. Aufmaß vor Ort geplant.",
    amount: 89000,
    created_at: iso(subDays(new Date(), 25)),
    updated_at: iso(subDays(new Date(), 5)),
    expected_closing_date: dateOnly(add(new Date(), { days: 21 })),
    sales_id: NORA_DEMO_SALES_ID,
  },
  {
    name: "Wartung Hausmeisterservice Objekt Saarbrücken",
    company_id: 7,
    contact_ids: [8],
    category: "hausmeisterdienst",
    stage: "aufmass-erledigt",
    description:
      "Laufender Wartungsvertrag Hausmeisterservice für Vonovia-Objekt in Saarbrücken. Aufmaß erledigt.",
    amount: 240000,
    created_at: iso(subDays(new Date(), 40)),
    updated_at: iso(subDays(new Date(), 6)),
    expected_closing_date: dateOnly(add(new Date(), { days: 30 })),
    sales_id: NORA_DEMO_SALES_ID,
  },
  {
    name: "Kalkulation Sanierung Treppenhaus",
    company_id: 3,
    contact_ids: [4],
    category: "fensterservice",
    stage: "in-kalkulation",
    description:
      "Bestandskunde Immobilien Hoffmann – Kalkulation für Fensterbeschläge im Treppenhaus.",
    amount: 175000,
    created_at: iso(subDays(new Date(), 35)),
    updated_at: iso(subDays(new Date(), 3)),
    expected_closing_date: dateOnly(add(new Date(), { days: 14 })),
    sales_id: NORA_DEMO_SALES_ID,
  },
  {
    name: "Ersatzteil Fenstergriff – Herstelleranfrage",
    company_id: 0,
    contact_ids: [0],
    category: "reparatur",
    stage: "wartet-auf-hersteller",
    description:
      "Spezialgriff nicht am Lager. Rückmeldung von Roto Frank wird abgewartet.",
    amount: 45000,
    created_at: iso(subDays(new Date(), 20)),
    updated_at: iso(subDays(new Date(), 4)),
    expected_closing_date: dateOnly(add(new Date(), { days: 20 })),
    sales_id: NORA_DEMO_SALES_ID,
  },
  {
    name: "Angebot Fensterbeschläge nachfassen",
    company_id: 3,
    contact_ids: [4],
    category: "fensterservice",
    stage: "angebot-gesendet",
    description:
      "Angebot für Fensterbeschläge an Immobilien Hoffmann gesendet. Bestandskunde mit offenem Angebot.",
    amount: 198000,
    created_at: iso(subDays(new Date(), 28)),
    updated_at: iso(subDays(new Date(), 3)),
    expected_closing_date: dateOnly(add(new Date(), { days: 5 })),
    sales_id: NORA_DEMO_SALES_ID,
  },
  {
    name: "Nachfassung Haustür-Angebot",
    company_id: 1,
    contact_ids: [1, 2],
    category: "reparatur",
    stage: "nachfassen",
    description:
      "Angebot für Haustür-Reparatur versendet. Nachfassung mit Herrn Klein steht an.",
    amount: 145000,
    created_at: iso(subDays(new Date(), 22)),
    updated_at: iso(subDays(new Date(), 1)),
    expected_closing_date: dateOnly(add(new Date(), { days: 3 })),
    sales_id: NORA_DEMO_SALES_ID,
  },
  {
    name: "Reparatur Fenstergriff angenommen",
    company_id: 0,
    contact_ids: [0],
    category: "reparatur",
    stage: "angenommen",
    description:
      "Kunde hat Reparaturauftrag für defekten Fenstergriff bestätigt. Termin wird koordiniert.",
    amount: 28000,
    created_at: iso(subDays(new Date(), 15)),
    updated_at: iso(subDays(new Date(), 2)),
    expected_closing_date: dateOnly(add(new Date(), { days: 7 })),
    sales_id: NORA_DEMO_SALES_ID,
  },
  {
    name: "Angebot Schaufenster – abgelehnt",
    company_id: 4,
    contact_ids: [5],
    category: "reparatur",
    stage: "abgelehnt",
    description:
      "Neukunde Restaurant Zum Brunnen hat Angebot wegen Preis abgelehnt.",
    amount: 65000,
    created_at: iso(subDays(new Date(), 10)),
    updated_at: iso(subDays(new Date(), 5)),
    expected_closing_date: dateOnly(subDays(new Date(), 2)),
    sales_id: NORA_DEMO_SALES_ID,
  },
  {
    name: "Hausmeisterdienst Objektübergabe abgeschlossen",
    company_id: 6,
    contact_ids: [7],
    category: "hausmeisterdienst",
    stage: "abgeschlossen",
    description:
      "Hausmeisterdienst für Gemeinde Blieskastel erfolgreich abgeschlossen. Dokumentation liegt vor.",
    amount: 420000,
    created_at: iso(subDays(new Date(), 90)),
    updated_at: iso(subDays(new Date(), 20)),
    expected_closing_date: dateOnly(subDays(new Date(), 25)),
    sales_id: NORA_DEMO_SALES_ID,
  },
];

export const generateNoraDeals = (): Deal[] => {
  const deals = dealSeeds.map((seed, id) => ({
    ...seed,
    id,
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
  const task = (
    id: number,
    contact_id: number,
    type: string,
    text: string,
    dueDays: number,
    done?: boolean,
  ): Task => ({
    id,
    contact_id,
    type,
    text,
    due_date: iso(
      done ? subDays(new Date(), 1) : add(new Date(), { days: dueDays }),
    ),
    done_date: done ? iso(subDays(new Date(), 1)) : undefined,
    sales_id: NORA_DEMO_SALES_ID,
  });

  contacts.find((c) => c.id === 0)!.nb_tasks = 2;
  contacts.find((c) => c.id === 1)!.nb_tasks = 2;
  contacts.find((c) => c.id === 3)!.nb_tasks = 1;
  contacts.find((c) => c.id === 4)!.nb_tasks = 2;
  contacts.find((c) => c.id === 6)!.nb_tasks = 1;
  contacts.find((c) => c.id === 8)!.nb_tasks = 1;
  contacts.find((c) => c.id === 9)!.nb_tasks = 1;

  return [
    task(0, 0, "rueckruf", "Rückruf bei Frau Müller wegen Fenstergriff", -1),
    task(1, 1, "besichtigung", "Besichtigung MFH Dudweiler – Haustür", 2),
    task(2, 9, "aufmass", "Aufmaß Dachgeschoss bei Familie Weber", 3),
    task(3, 6, "herstelleranfrage", "Roto Frank: Ersatzteil Fenstergriff anfragen", 1),
    task(4, 4, "angebot-erstellen", "Angebot Fensterbeschläge für Immobilien Hoffmann", -2),
    task(5, 4, "angebot-nachfassen", "Angebot bei Frau Hoffmann nachfassen", 1),
    task(6, 3, "termin-vereinbaren", "Wartungstermin Autohaus Schneider abstimmen", 4),
    task(7, 7, "dokumentation", "Übergabeprotokoll Gemeinde Blieskastel fertigstellen", 5),
    task(8, 1, "angebot-nachfassen", "Haustür-Angebot bei Herrn Klein nachfassen", 0),
    task(9, 8, "besichtigung", "Objektbegehung Vonovia Saarbrücken", 6),
    task(10, 0, "termin-vereinbaren", "Montagetermin Fenstergriff mit Frau Müller", 2),
    task(11, 2, "rueckruf", "Rückfrage Verwaltung Wohnungsbau Saar", 3, true),
  ];
};

export const generateNoraContactNotes = (contacts: Contact[]): ContactNote[] => {
  const notes: ContactNote[] = [];
  let id = 0;

  const addNote = (
    contact_id: number,
    text: string,
    daysAgo: number,
    status: string,
  ) => {
    const date = subDays(new Date(), daysAgo);
    notes.push({
      id: id++,
      contact_id,
      text,
      date: iso(date),
      sales_id: NORA_DEMO_SALES_ID,
      status,
    });
    const contact = contacts[contact_id];
    if (contact && new Date(date) > new Date(contact.last_seen)) {
      contact.last_seen = iso(date);
    }
    contact.status = status;
  };

  addNote(
    0,
    "Frau Müller meldet defekten Fenstergriff im WZ. Fotos per WhatsApp erhalten. Termin für Besichtigung gewünscht.",
    1,
    "hot",
  );
  addNote(
    1,
    "Herr Klein: Haustür MFH Dudweiler schließt nicht. Mieter beschweren sich. Dringlichkeit hoch.",
    2,
    "hot",
  );
  addNote(
    4,
    "Angebot für Fensterbeschläge versendet. Frau Hoffmann meldet sich nächste Woche.",
    3,
    "in-contract",
  );
  addNote(
    3,
    "Wartungstermin Autohaus für nächsten Monat in Abstimmung.",
    5,
    "warm",
  );
  addNote(
    9,
    "Aufmaß-Termin für Dachfenster am Donnerstag 14:00 bestätigt.",
    2,
    "warm",
  );
  addNote(
    8,
    "Wartungsvertrag Vonovia läuft planmäßig. Nächste Begehung in 6 Wochen.",
    6,
    "warm",
  );
  addNote(
    5,
    "Herr Brunn hat Angebot erhalten, vergleicht mit anderem Anbieter.",
    7,
    "cold",
  );
  addNote(
    7,
    "Objektübergabe Gemeinde Blieskastel dokumentiert und abgeschlossen.",
    20,
    "in-contract",
  );

  return notes;
};

export const generateNoraDealNotes = (_deals: Deal[]): DealNote[] => {
  return [
    {
      id: 0,
      deal_id: 7,
      text: "Angebot per E-Mail an Frau Hoffmann gesendet. Gültigkeit 14 Tage.",
      date: iso(subDays(new Date(), 3)),
      sales_id: NORA_DEMO_SALES_ID,
    },
    {
      id: 1,
      deal_id: 8,
      text: "Nachfass-Telefonat mit Herrn Klein vereinbart für Freitag 10:00.",
      date: iso(subDays(new Date(), 1)),
      sales_id: NORA_DEMO_SALES_ID,
    },
    {
      id: 2,
      deal_id: 6,
      text: "Herstelleranfrage an Roto Frank gesendet. Artikelnummer liegt vor.",
      date: iso(subDays(new Date(), 4)),
      sales_id: NORA_DEMO_SALES_ID,
    },
  ];
};

/** Aktualisiert nb_contacts / nb_deals anhand der generierten Daten */
export const finalizeNoraCounts = (db: Db) => {
  db.companies.forEach((c) => {
    c.nb_contacts = db.contacts.filter((ct) => ct.company_id === c.id).length;
    c.nb_deals = db.deals.filter((d) => d.company_id === c.id).length;
  });
};

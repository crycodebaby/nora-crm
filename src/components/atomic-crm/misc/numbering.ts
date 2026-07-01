/** Shared Nora business number formatting — mirrors Postgres functions in numbering migration */

export const formatCustomerNumber = (seq: number): string =>
  `KD-${String(seq).padStart(6, "0")}`;

export const formatCaseNumber = (year: number, seq: number): string =>
  `VG-${year}-${String(seq).padStart(6, "0")}`;

const parseCustomerNumber = (value: string): number | null => {
  const match = value.match(/^KD-(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
};

const parseCaseNumber = (
  value: string,
): { year: number; seq: number } | null => {
  const match = value.match(/^VG-(\d{4})-(\d+)$/);
  if (!match) return null;
  return {
    year: Number.parseInt(match[1], 10),
    seq: Number.parseInt(match[2], 10),
  };
};

type NumberCounterState = {
  customer: number;
  dealByYear: Record<number, number>;
};

const counters: NumberCounterState = {
  customer: 0,
  dealByYear: {},
};

export const initNumberCountersFromRecords = (
  companies: { customer_number?: string }[],
  deals: { case_number?: string; created_at?: string }[],
) => {
  let maxCustomer = 0;
  for (const company of companies) {
    if (company.customer_number) {
      const seq = parseCustomerNumber(company.customer_number);
      if (seq !== null) maxCustomer = Math.max(maxCustomer, seq);
    }
  }
  counters.customer = maxCustomer;

  const dealByYear: Record<number, number> = {};
  for (const deal of deals) {
    if (deal.case_number) {
      const parsed = parseCaseNumber(deal.case_number);
      if (parsed) {
        dealByYear[parsed.year] = Math.max(
          dealByYear[parsed.year] ?? 0,
          parsed.seq,
        );
      }
    }
  }
  counters.dealByYear = dealByYear;
};

export const nextCustomerNumberForFakeRest = (): string => {
  counters.customer += 1;
  return formatCustomerNumber(counters.customer);
};

export const nextCaseNumberForFakeRest = (createdAt?: string): string => {
  const year = createdAt
    ? new Date(createdAt).getFullYear()
    : new Date().getFullYear();
  counters.dealByYear[year] = (counters.dealByYear[year] ?? 0) + 1;
  return formatCaseNumber(year, counters.dealByYear[year]);
};

/** Assign customer numbers by created_at / id order (demo seed). */
export const assignCustomerNumbers = <
  T extends { id?: number; created_at: string; customer_number?: string },
>(
  records: T[],
): (T & { customer_number: string })[] => {
  const order = new Map(
    [...records]
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
          (a.id ?? 0) - (b.id ?? 0),
      )
      .map((record, index) => [record.id, index + 1]),
  );

  return records.map((record) => ({
    ...record,
    customer_number: formatCustomerNumber(order.get(record.id) ?? 1),
  })) as (T & { customer_number: string })[];
};

/** Assign case numbers per calendar year by created_at / id order (demo seed). */
export const assignCaseNumbers = <
  T extends { id: number; created_at: string; case_number?: string },
>(
  records: T[],
): (T & { case_number: string })[] => {
  const byYear: Record<number, number> = {};
  const sorted = [...records].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
      a.id - b.id,
  );
  const caseById = new Map<number, string>();

  for (const record of sorted) {
    const year = new Date(record.created_at).getFullYear();
    byYear[year] = (byYear[year] ?? 0) + 1;
    caseById.set(record.id, formatCaseNumber(year, byYear[year]));
  }

  return records.map((record) => ({
    ...record,
    case_number: caseById.get(record.id)!,
  })) as (T & { case_number: string })[];
};

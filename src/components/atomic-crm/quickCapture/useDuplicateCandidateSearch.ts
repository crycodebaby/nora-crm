import type { DataProvider } from "ra-core";
import { useEffect, useMemo, useRef, useState } from "react";

import { performGlobalSearch } from "../misc/globalSearch";
import type { Company, Contact } from "../types";
import {
  buildDuplicateSearchCacheKey,
  buildDuplicateSearchInput,
  DUPLICATE_SEARCH_DEBOUNCE_MS,
  rankDuplicateCandidates,
  shouldRunDuplicateSearch,
  type DuplicateCandidate,
} from "./duplicateCandidateUtils";
import { mergeCustomerSearchResults } from "./mergeCustomerSearchResults";
import {
  collectSearchCompanies,
  collectSearchContacts,
} from "./quickCaptureUtils";

type UseDuplicateCandidateSearchParams = {
  enabled: boolean;
  searchQuery: string;
  newCompanyName: string;
  createNewCompany: boolean;
  contactPhone: string;
  contactEmail: string;
  dataProvider: DataProvider;
};

type SearchCacheEntry = {
  candidates: DuplicateCandidate[];
  searchCompanies: Company[];
};

const searchCache = new Map<string, SearchCacheEntry>();

export function useDuplicateCandidateSearch({
  enabled,
  searchQuery,
  newCompanyName,
  createNewCompany,
  contactPhone,
  contactEmail,
  dataProvider,
}: UseDuplicateCandidateSearchParams) {
  const input = useMemo(
    () =>
      buildDuplicateSearchInput({
        searchQuery,
        newCompanyName,
        createNewCompany,
        contactPhone,
        contactEmail,
      }),
    [
      contactEmail,
      contactPhone,
      createNewCompany,
      newCompanyName,
      searchQuery,
    ],
  );

  const [debouncedInput, setDebouncedInput] = useState(input);
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [searchCompanies, setSearchCompanies] = useState<Company[]>([]);
  const [isPending, setIsPending] = useState(false);
  const latestRequestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedInput(input);
    }, DUPLICATE_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    if (!enabled) {
      setCandidates([]);
      setSearchCompanies([]);
      setIsPending(false);
      return;
    }

    if (!shouldRunDuplicateSearch(debouncedInput)) {
      setCandidates([]);
      setSearchCompanies([]);
      setIsPending(false);
      return;
    }

    const cacheKey = buildDuplicateSearchCacheKey(debouncedInput);
    const cached = searchCache.get(cacheKey);
    if (cached) {
      setCandidates(cached.candidates);
      setSearchCompanies(cached.searchCompanies);
      setIsPending(false);
      return;
    }

    const requestId = ++latestRequestRef.current;
    let cancelled = false;

    const run = async () => {
      setIsPending(true);

      const queryForSearch =
        debouncedInput.query?.trim() ||
        debouncedInput.phone?.trim() ||
        debouncedInput.email?.trim() ||
        debouncedInput.name?.trim() ||
        "";

      let companies: Company[] = [];
      let contacts: Contact[] = [];

      if (queryForSearch) {
        const result = await performGlobalSearch(dataProvider, queryForSearch);
        if (cancelled || requestId !== latestRequestRef.current) return;

        if (result.kind === "results") {
          companies = collectSearchCompanies(result);
          contacts = collectSearchContacts(result);
        } else if (
          result.kind === "direct" &&
          result.resource === "companies"
        ) {
          const { data } = await dataProvider.getOne<Company>("companies", {
            id: result.id,
          });
          companies = [data];
        }
      }

      const ranked = rankDuplicateCandidates(
        companies,
        debouncedInput,
        contacts,
      );

      if (cancelled || requestId !== latestRequestRef.current) return;

      const entry = { candidates: ranked, searchCompanies: companies };
      searchCache.set(cacheKey, entry);
      setCandidates(ranked);
      setSearchCompanies(companies);
      setIsPending(false);
    };

    void run().catch(() => {
      if (cancelled || requestId !== latestRequestRef.current) return;
      setCandidates([]);
      setSearchCompanies([]);
      setIsPending(false);
    });

    return () => {
      cancelled = true;
    };
  }, [dataProvider, debouncedInput, enabled]);

  const mergedEntries = useMemo(
    () => mergeCustomerSearchResults(searchCompanies, candidates),
    [candidates, searchCompanies],
  );

  return { candidates, searchCompanies, mergedEntries, isPending };
}

/** @internal test helper */
export function clearDuplicateSearchCacheForTests() {
  searchCache.clear();
}

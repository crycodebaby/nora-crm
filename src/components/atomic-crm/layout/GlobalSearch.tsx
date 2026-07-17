import { Search } from "lucide-react";
import { useDataProvider, useRedirect, useTranslate } from "ra-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { findDealLabel } from "../deals/dealUtils";
import {
  canSearchQuery,
  getContactPrimaryEmail,
  getContactPrimaryPhone,
  performGlobalSearch,
  type GlobalSearchGroupedHit,
  type GlobalSearchResponse,
} from "../misc/globalSearch";
import { noraCreatePath } from "../routing/noraRoutes";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { CrmDataProvider } from "../providers/types";
import type { Company, Contact } from "../types";
import { NoraQueryError } from "../misc/NoraQueryError";

const DEBOUNCE_MS = 300;

const GLOBAL_SEARCH_INPUT_ID = "nora-global-search";
const GLOBAL_SEARCH_MOBILE_INPUT_ID = "nora-global-search-mobile";
const GLOBAL_SEARCH_RESULTS_ID = "nora-global-search-results";

/** Reduce Chrome Wallet / loyalty-card autofill on search fields */
const globalSearchInputProps = {
  type: "search" as const,
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  inputMode: "search" as const,
};

function useDebouncedValue<T>(value: T, delay = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

type GlobalSearchProps = {
  variant?: "inline" | "mobile";
  className?: string;
};

export const GlobalSearch = ({
  variant = "inline",
  className,
}: GlobalSearchProps) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const redirect = useRedirect();
  const { dealStages, dealCategories } = useConfigurationContext();
  const inputId =
    variant === "mobile"
      ? GLOBAL_SEARCH_MOBILE_INPUT_ID
      : GLOBAL_SEARCH_INPUT_ID;
  const inputName = inputId;

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebouncedValue(query);
  const searchEnabled = canSearchQuery(debouncedQuery);

  const {
    data: result,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["globalSearch", debouncedQuery],
    queryFn: () => performGlobalSearch(dataProvider, debouncedQuery),
    enabled: searchEnabled && (variant === "mobile" ? mobileOpen : open),
    staleTime: 30_000,
    retry: false,
  });

  const navigateTo = useCallback(
    (resource: "companies" | "contacts" | "deals", id: Company["id"]) => {
      redirect(
        noraCreatePath({ resource, type: "show", id }),
        undefined,
        undefined,
        undefined,
        { _scrollToTop: true },
      );
      setQuery("");
      setOpen(false);
      setMobileOpen(false);
    },
    [redirect],
  );

  useEffect(() => {
    if (result?.kind === "direct") {
      navigateTo(result.resource, result.id);
    }
  }, [result, navigateTo]);

  const handleSelect = (
    resource: "companies" | "contacts" | "deals",
    id: Company["id"],
  ) => {
    navigateTo(resource, id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setMobileOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (event.key !== "Enter" || !result || result.kind !== "results") {
      return;
    }
    const first = result.companies[0] ?? result.contacts[0] ?? result.deals[0];
    if (!first) return;
    const resource = result.companies[0]
      ? "companies"
      : result.contacts[0]
        ? "contacts"
        : "deals";
    handleSelect(resource, first.id);
  };

  const resultsPanel = (
    <SearchResults
      result={result}
      isFetching={isFetching}
      error={error}
      onRetry={() => refetch()}
      searchEnabled={searchEnabled}
      query={debouncedQuery}
      dealStages={dealStages}
      dealCategories={dealCategories}
      onSelect={handleSelect}
    />
  );

  if (variant === "mobile") {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("nora-touch-target shrink-0", className)}
          aria-label={translate("crm.search.placeholder")}
          onClick={() => setMobileOpen(true)}
        >
          <Search className="h-5 w-5" />
        </Button>
        <CommandDialog
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          title={translate("crm.search.title")}
          description={translate("crm.search.hint")}
        >
          <div className="border-b px-3 py-2">
            <Input
              ref={inputRef}
              id={inputId}
              name={inputName}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={translate("crm.search.hint")}
              className="nora-search-input nora-touch-target border-0 shadow-none focus-visible:ring-0"
              role="searchbox"
              autoFocus
              {...globalSearchInputProps}
            />
          </div>
          {resultsPanel}
        </CommandDialog>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn("relative w-full min-w-0", className)}>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={inputRef}
            id={inputId}
            name={inputName}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={translate("crm.search.hint")}
            aria-label={translate("crm.search.placeholder")}
            aria-expanded={open}
            aria-controls={GLOBAL_SEARCH_RESULTS_ID}
            role="searchbox"
            className="nora-search-input nora-touch-target pl-9 h-10 w-full bg-background/95"
            {...globalSearchInputProps}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        id={GLOBAL_SEARCH_RESULTS_ID}
        align="end"
        className="w-[min(100vw-2rem,28rem)] p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {resultsPanel}
      </PopoverContent>
    </Popover>
  );
};

const SearchResults = ({
  result,
  isFetching,
  error,
  onRetry,
  searchEnabled,
  query,
  dealStages,
  dealCategories,
  onSelect,
}: {
  result: GlobalSearchResponse | undefined;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  searchEnabled: boolean;
  query: string;
  dealStages: { value: string; label: string }[];
  dealCategories: { value: string; label: string }[];
  onSelect: (
    resource: "companies" | "contacts" | "deals",
    id: Company["id"],
  ) => void;
}) => {
  const translate = useTranslate();

  if (!searchEnabled && query.length > 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground text-center">
        {translate("crm.search.min_chars")}
      </p>
    );
  }

  if (!searchEnabled) {
    return null;
  }

  if (isFetching && !result) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground text-center">
        {translate("crm.common.loading")}
      </p>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-4">
        <NoraQueryError error={error} onRetry={onRetry} />
      </div>
    );
  }

  if (!result || result.kind === "idle" || result.kind === "direct") {
    return null;
  }

  if (result.kind === "min_chars") {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground text-center">
        {translate("crm.search.min_chars")}
      </p>
    );
  }

  if (result.kind === "empty") {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground text-center">
        {translate("crm.search.no_results")}
      </p>
    );
  }

  return (
    <GroupedResults
      result={result}
      dealStages={dealStages}
      dealCategories={dealCategories}
      onSelect={onSelect}
    />
  );
};

const GroupedResults = ({
  result,
  dealStages,
  dealCategories,
  onSelect,
}: {
  result: GlobalSearchGroupedHit;
  dealStages: { value: string; label: string }[];
  dealCategories: { value: string; label: string }[];
  onSelect: (
    resource: "companies" | "contacts" | "deals",
    id: Company["id"],
  ) => void;
}) => {
  const translate = useTranslate();

  return (
    <Command shouldFilter={false}>
      <CommandList className="max-h-[min(70vh,24rem)]">
        <CommandEmpty>{translate("crm.search.no_results")}</CommandEmpty>

        {result.companies.length > 0 ? (
          <CommandGroup heading={translate("crm.search.group_companies")}>
            {result.companies.map((company) => (
              <CommandItem
                key={`company-${company.id}`}
                value={`company-${company.id}`}
                onSelect={() => onSelect("companies", company.id)}
                className="nora-touch-target flex flex-col items-start gap-0.5 py-3"
              >
                <span className="nora-list-title text-sm">{company.name}</span>
                <span className="nora-muted text-xs">
                  {company.customer_number}
                  {company.phone_number ? ` · ${company.phone_number}` : null}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {result.contacts.length > 0 ? (
          <CommandGroup heading={translate("crm.search.group_contacts")}>
            {result.contacts.map((contact) => (
              <CommandItem
                key={`contact-${contact.id}`}
                value={`contact-${contact.id}`}
                onSelect={() => onSelect("contacts", contact.id)}
                className="nora-touch-target flex flex-col items-start gap-0.5 py-3"
              >
                <span className="nora-list-title text-sm">
                  {contact.first_name} {contact.last_name}
                </span>
                <ContactSecondaryLine contact={contact} />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {result.deals.length > 0 ? (
          <CommandGroup heading={translate("crm.search.group_deals")}>
            {result.deals.map((deal) => (
              <CommandItem
                key={`deal-${deal.id}`}
                value={`deal-${deal.id}`}
                onSelect={() => onSelect("deals", deal.id)}
                className="nora-touch-target flex flex-col items-start gap-0.5 py-3"
              >
                <span className="nora-list-title text-sm">{deal.name}</span>
                <span className="nora-muted text-xs">
                  {deal.case_number}
                  {" · "}
                  {findDealLabel(dealStages, deal.stage) ?? deal.stage}
                  {deal.category
                    ? ` · ${
                        dealCategories.find((c) => c.value === deal.category)
                          ?.label ?? deal.category
                      }`
                    : null}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </Command>
  );
};

const ContactSecondaryLine = ({ contact }: { contact: Contact }) => {
  const email = getContactPrimaryEmail(contact);
  const phone = getContactPrimaryPhone(contact);
  const parts = [contact.company_name, phone, email].filter(Boolean);

  if (!parts.length) return null;

  return <span className="nora-muted text-xs">{parts.join(" · ")}</span>;
};

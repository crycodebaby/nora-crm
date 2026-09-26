import { ArrowRight, Building2 } from "lucide-react";
import { useGetList } from "ra-core";
import { useState } from "react";
import { Link } from "react-router";

import { MobileContent } from "../layout/MobileContent";
import MobileHeader from "../layout/MobileHeader";
import { noraCreatePath } from "../routing/noraRoutes";
import type { Company } from "../types";

export const MobileCompanyList = () => {
  const [page, setPage] = useState(1);
  const { data, total, isPending, isError } = useGetList<Company>("companies", {
    pagination: { page, perPage: 30 },
    sort: { field: "name", order: "ASC" },
  });

  return (
    <>
      <MobileHeader>
        <h1 className="text-lg font-semibold">Kunden</h1>
      </MobileHeader>
      <MobileContent>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {isPending ? (
            <p className="p-5 text-sm text-muted-foreground">Lädt …</p>
          ) : isError ? (
            <p className="p-5 text-sm text-destructive">
              Kunden konnten nicht geladen werden.
            </p>
          ) : data?.length ? (
            data.map((company) => (
              <Link
                key={company.id}
                to={noraCreatePath({
                  resource: "companies",
                  type: "show",
                  id: company.id,
                })}
                className="flex min-h-[4.75rem] items-center gap-3 border-b border-border/70 px-4 py-3 last:border-b-0"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                  <Building2 className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {company.name}
                </span>
                <ArrowRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </Link>
            ))
          ) : (
            <p className="p-5 text-sm text-muted-foreground">Keine Kunden.</p>
          )}
        </div>
        <div className="mt-4 flex justify-between gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
            className="min-h-11 rounded-lg border border-border px-4 text-sm disabled:opacity-40"
          >
            Zurück
          </button>
          <button
            type="button"
            disabled={page * 30 >= (total ?? 0)}
            onClick={() => setPage((value) => value + 1)}
            className="min-h-11 rounded-lg border border-border px-4 text-sm disabled:opacity-40"
          >
            Weitere Kunden
          </button>
        </div>
      </MobileContent>
    </>
  );
};

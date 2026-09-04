import type { ReactNode } from "react";
import { Notification } from "@/components/admin/notification";
import {
  defaultOperatorName,
  defaultSmairysDarkLogo,
  defaultSmairysLightLogo,
  defaultOperatorMark,
} from "../root/defaultConfiguration";

export type EmployeeAccessMode = "anmelden" | "einladung" | "passwort";

type EmployeeAccessShellProps = {
  children: ReactNode;
  mode?: EmployeeAccessMode;
};

/**
 * Shared public shell for employee access (login / invite / password setup).
 * Brand hierarchy: Ergart → Zugangszweck → Smairys (technical).
 * Nora product branding stays inside the authenticated app.
 *
 * V1B: the card is the only surface the employee reads. It is 26 rem on
 * desktop, fluid below, and every colour on this shell goes through the
 * `--nora-access-*` tokens (light by decision — a later dark variant only
 * has to redefine the tokens). Three compositions, not one scaled layout:
 * two columns from 1024 px, a stacked brand block on tablets, a single brand
 * row on phones with Smairys below the fold.
 */
export const EmployeeAccessShell = ({ children }: EmployeeAccessShellProps) => {
  return (
    <div className="nora-access-shell min-h-svh flex">
      <div className="relative grid w-full lg:grid-cols-2">
        <aside
          className="nora-access-aside relative hidden lg:flex flex-col px-16 py-16 text-white"
          aria-label="Markenbereich"
        >
          <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-between">
            <div className="flex flex-col gap-14">
              <img
                src={defaultOperatorMark}
                alt={defaultOperatorName}
                className="h-[5.5rem] w-auto max-w-[16rem] object-contain object-left"
              />
              <div className="max-w-[22rem] space-y-4">
                <h1 className="text-[2.125rem] font-semibold tracking-[-0.03em] leading-[1.12] text-white">
                  Mitarbeiterzugang der Ergart Gruppe
                </h1>
                <p className="text-[1.0625rem] leading-[1.5] text-white/50 font-normal">
                  Sicherer Zugang zu den digitalen Arbeitsbereichen
                </p>
              </div>
            </div>

            <div className="mt-20 max-w-[min(100%,38rem)]">
              <div className="mb-6 h-px w-full bg-white/10" />
              <div className="flex flex-col">
                <p className="mb-0 text-[0.6875rem] font-medium tracking-[0.08em] text-white/35 leading-none">
                  Technische Entwicklung
                </p>
                {/* Negative top margin only — trims PNG transparent padding above the mark */}
                <img
                  src={defaultSmairysLightLogo}
                  alt="Smairys"
                  className="-mt-3 h-[13.5rem] w-auto max-w-full object-contain object-left brightness-110 contrast-105"
                />
              </div>
            </div>
          </div>
        </aside>

        {/* `my-auto` on the column, not `justify-center` on the flex parent:
            centred when there is room, scrolls from the top when there is
            not — a tall step on a short viewport must never clip its heading. */}
        <main className="flex w-full flex-col px-4 py-6 sm:px-10 sm:py-10 lg:px-16">
          <div className="my-auto w-full">
            {/* Phone: one brand row. Tablet: stacked block. */}
            <div className="lg:hidden mb-6 sm:mb-10">
              <div className="flex items-center gap-4 sm:block sm:space-y-8">
                <img
                  src={defaultOperatorMark}
                  alt={defaultOperatorName}
                  className="h-10 w-auto max-w-[7rem] shrink-0 object-contain sm:h-14 sm:max-w-[11rem]"
                />
                <div className="min-w-0 sm:space-y-2">
                  <p className="text-[1.0625rem] font-semibold tracking-[-0.02em] leading-snug sm:text-[1.375rem]">
                    Mitarbeiterzugang der Ergart Gruppe
                  </p>
                  <p className="hidden text-[0.9375rem] leading-relaxed nora-access-muted-text sm:block">
                    Sicherer Zugang zu den digitalen Arbeitsbereichen
                  </p>
                </div>
              </div>
            </div>

            <div
              data-access-card
              className="nora-access-card [&_.text-muted-foreground]:nora-access-muted-text [&_h2]:text-[var(--nora-access-ink)] [&_label]:text-[var(--nora-access-text)]"
            >
              {children}
            </div>

            <div className="lg:hidden mt-10 space-y-3 sm:mt-12 sm:space-y-4">
              <div className="h-px w-full bg-black/10" />
              <p className="text-[0.6875rem] font-medium tracking-[0.08em] nora-access-muted-text">
                Technische Entwicklung
              </p>
              {/* The PNG is a square with a white frame around the wordmark: the
                  negative margins trim the frame, `mix-blend-multiply` lets the
                  white disappear into the ground so no box is drawn. */}
              <img
                src={defaultSmairysDarkLogo}
                alt="Smairys"
                className="-my-10 h-32 w-auto max-w-full object-contain object-left mix-blend-multiply sm:-my-12 sm:h-36"
              />
            </div>
          </div>
        </main>
      </div>
      <Notification />
    </div>
  );
};

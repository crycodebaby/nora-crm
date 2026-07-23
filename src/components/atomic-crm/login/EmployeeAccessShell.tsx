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
 * Shared public shell for employee access (login / invite / password reset).
 * Brand hierarchy: Ergart → Zugangszweck → Smairys (technical).
 * Nora product branding stays inside the authenticated app.
 */
export const EmployeeAccessShell = ({ children }: EmployeeAccessShellProps) => {
  return (
    <div className="min-h-svh flex bg-[#e8e8ed] text-[#111111]">
      <div className="relative grid w-full lg:grid-cols-2">
        <aside
          className="relative hidden lg:flex flex-col px-16 py-16 text-white"
          aria-label="Markenbereich"
          style={{
            background:
              "linear-gradient(180deg, #111111 0%, #0a0a0a 100%)",
          }}
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

        <main className="flex flex-col justify-center w-full px-6 py-10 sm:px-10 lg:px-16">
          <div className="lg:hidden mb-10 space-y-8">
            <img
              src={defaultOperatorMark}
              alt={defaultOperatorName}
              className="h-14 w-auto max-w-[11rem] object-contain"
            />
            <div className="space-y-2">
              <p className="text-[1.375rem] font-semibold tracking-[-0.02em] leading-snug">
                Mitarbeiterzugang der Ergart Gruppe
              </p>
              <p className="text-[0.9375rem] text-[#3a3a3c] leading-relaxed">
                Sicherer Zugang zu den digitalen Arbeitsbereichen
              </p>
            </div>
          </div>

          <div className="w-full mx-auto lg:max-w-[22.5rem]">
            <div className="rounded-[1.25rem] bg-[#f0f0f3] px-7 py-9 shadow-[0_2px_24px_rgba(0,0,0,0.06)] sm:px-8 text-[#111111] [&_.text-muted-foreground]:text-[#3a3a3c] [&_h2]:text-[#111111] [&_label]:text-[#1d1d1f] [&_a]:text-[#1d1d1f] [&_button.text-muted-foreground]:text-[#3a3a3c]">
              {children}
            </div>

            <div className="lg:hidden mt-12 space-y-4">
              <div className="h-px w-full bg-black/10" />
              <p className="text-[0.6875rem] font-medium tracking-[0.08em] text-[#3a3a3c]">
                Technische Entwicklung
              </p>
              <img
                src={defaultSmairysDarkLogo}
                alt="Smairys"
                className="h-12 w-auto max-w-[14rem] object-contain"
              />
            </div>
          </div>
        </main>
      </div>
      <Notification />
    </div>
  );
};

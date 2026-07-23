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
    <div className="min-h-svh flex bg-[#f7f6f4] text-foreground">
      <div className="relative grid w-full lg:grid-cols-2">
        <aside
          className="relative hidden lg:flex flex-col justify-between overflow-hidden px-12 py-12 text-white"
          aria-label="Markenbereich"
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(165deg, #1f1f1f 0%, #2c2c2c 48%, #3a3532 100%)",
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.12] motion-safe:opacity-[0.14]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 18% 22%, rgba(255,255,255,0.35), transparent 42%), radial-gradient(circle at 82% 78%, rgba(255,255,255,0.18), transparent 36%)",
            }}
            aria-hidden
          />
          <div className="relative z-10 flex flex-col gap-10 max-w-md">
            <div className="flex items-center gap-4">
              <img
                src={defaultOperatorMark}
                alt={defaultOperatorName}
                className="h-14 w-auto max-w-[11rem] object-contain"
              />
            </div>
            <div className="space-y-4">
              <h1 className="text-3xl font-semibold tracking-tight leading-tight">
                Mitarbeiterzugang der Ergart Gruppe
              </h1>
              <p className="text-base text-white/75 leading-relaxed">
                Sicherer Zugang zu den digitalen Arbeitsbereichen
              </p>
            </div>
          </div>
          <div className="relative z-10 mt-16">
            <p className="text-xs uppercase tracking-[0.18em] text-white/45 mb-3">
              Technische Entwicklung
            </p>
            <img
              src={defaultSmairysLightLogo}
              alt="Smairys"
              className="h-8 w-auto max-w-[10rem] object-contain opacity-90"
            />
          </div>
        </aside>

        <main className="flex flex-col justify-center w-full px-5 py-8 sm:px-8 lg:px-12">
          <div className="lg:hidden mb-8 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <img
                src={defaultOperatorMark}
                alt={defaultOperatorName}
                className="h-10 w-auto max-w-[8rem] object-contain"
              />
              <img
                src={defaultSmairysDarkLogo}
                alt="Smairys"
                className="h-6 w-auto max-w-[7rem] object-contain opacity-80"
              />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-semibold tracking-tight">
                Mitarbeiterzugang der Ergart Gruppe
              </p>
              <p className="text-sm text-muted-foreground">
                Sicherer Zugang zu den digitalen Arbeitsbereichen
              </p>
            </div>
          </div>

          <div className="w-full mx-auto lg:max-w-[24rem]">
            <div className="rounded-2xl border border-black/5 bg-white px-6 py-8 shadow-[0_18px_50px_-28px_rgba(28,25,23,0.45)] sm:px-8">
              {children}
            </div>
          </div>
        </main>
      </div>
      <Notification />
    </div>
  );
};

import { useEffect, useRef, useState } from "react";
import { Form, required, useLogin, useNotify, useTranslate } from "ra-core";
import type { FieldValues, SubmitHandler } from "react-hook-form";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/admin/text-input";
import { isNoraDemoMode } from "@/components/atomic-crm/misc/noraDemoMode";
import { useFinalizeDemoLogin } from "@/components/atomic-crm/misc/useSwitchDemoRole";
import { useConfigurationContext } from "@/components/atomic-crm/root/ConfigurationContext";
import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";
import { SSOAuthButton } from "./SSOAuthButton";
import {
  EmployeeAccessShell,
  type EmployeeAccessMode,
} from "./EmployeeAccessShell";

const GENERIC_LOGIN_ERROR =
  "Anmeldung fehlgeschlagen. Bitte prüfen Sie Ihre Angaben.";

const resolveMode = (search: string): EmployeeAccessMode => {
  const mode = new URLSearchParams(search).get("mode");
  if (mode === "einladung") return "einladung";
  if (mode === "passwort" || mode === "passwort-vergessen") return "passwort";
  return "anmelden";
};

const modeSearch = (mode: EmployeeAccessMode, redirectTo?: string) => {
  const params = new URLSearchParams();
  params.set("mode", mode === "passwort" ? "passwort" : mode);
  if (redirectTo) params.set("redirect", redirectTo);
  return `?${params.toString()}`;
};

/**
 * Public employee access: Anmelden / Einladung / Passwort vergessen.
 * No public registration. Nora branding appears only after authentication.
 */
export const StartPage = ({ redirectTo }: { redirectTo?: string }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = resolveMode(location.search);
  const redirect =
    redirectTo ??
    new URLSearchParams(location.search).get("redirect") ??
    undefined;

  return (
    <EmployeeAccessShell mode={mode}>
      {mode === "einladung" ? (
        <InviteActivationPanel
          onSwitch={(next) =>
            navigate({ pathname: "/login", search: modeSearch(next, redirect) })
          }
        />
      ) : mode === "passwort" ? (
        <ForgotPasswordPanel
          onSwitch={(next) =>
            navigate({ pathname: "/login", search: modeSearch(next, redirect) })
          }
        />
      ) : (
        <SignInPanel
          redirectTo={redirect}
          onSwitch={(next) =>
            navigate({ pathname: "/login", search: modeSearch(next, redirect) })
          }
        />
      )}
    </EmployeeAccessShell>
  );
};

const SignInPanel = ({
  redirectTo,
  onSwitch,
}: {
  redirectTo?: string;
  onSwitch: (mode: EmployeeAccessMode) => void;
}) => {
  const { googleWorkplaceDomain, disableEmailPasswordAuthentication } =
    useConfigurationContext();
  const [loading, setLoading] = useState(false);
  const hasDisplayedRecoveryNotification = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const login = useLogin();
  const finalizeDemoLogin = useFinalizeDemoLogin();
  const notify = useNotify();
  const translate = useTranslate();

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const shouldNotify = searchParams.get("passwordRecoveryEmailSent") === "1";
    if (!shouldNotify || hasDisplayedRecoveryNotification.current) return;

    hasDisplayedRecoveryNotification.current = true;
    notify("crm.auth.recovery_email_sent", {
      type: "success",
      messageArgs: {
        _: "Wenn ein Zugang zu dieser Adresse existiert, erhalten Sie in Kürze eine E-Mail.",
      },
    });
    searchParams.delete("passwordRecoveryEmailSent");
    const nextSearch = searchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "?mode=anmelden",
      },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate, notify]);

  const handleSubmit: SubmitHandler<FieldValues> = (values) => {
    setLoading(true);
    login(values, redirectTo)
      .then(async () => {
        if (isNoraDemoMode) {
          await finalizeDemoLogin(redirectTo);
          return;
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        notify(GENERIC_LOGIN_ERROR, {
          type: "error",
          messageArgs: { _: GENERIC_LOGIN_ERROR },
        });
      });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center lg:text-left">
        <h2 className="text-2xl font-semibold tracking-tight">
          {translate("ra.auth.sign_in", { _: "Anmelden" })}
        </h2>
        <p className="text-sm text-muted-foreground">
          Melden Sie sich mit Ihrer geschäftlichen E-Mail-Adresse an.
        </p>
        {isNoraDemoMode ? (
          <p className="text-sm text-muted-foreground">
            {translate("crm.demo.login_hint")}
          </p>
        ) : null}
      </div>

      {disableEmailPasswordAuthentication ? null : (
        <Form className="space-y-5" onSubmit={handleSubmit}>
          <TextInput
            label="Geschäftliche E-Mail-Adresse"
            source="email"
            type="email"
            autoComplete="username"
            validate={required()}
          />
          <TextInput
            label="Passwort"
            source="password"
            type="password"
            autoComplete="current-password"
            validate={required()}
          />
          <Button
            type="submit"
            size="lg"
            className="nora-primary-action nora-touch-target w-full"
            disabled={loading}
          >
            Anmelden
          </Button>
        </Form>
      )}

      {googleWorkplaceDomain ? (
        <SSOAuthButton className="w-full" domain={googleWorkplaceDomain}>
          {translate("crm.auth.sign_in_google_workspace", {
            _: "Mit Google Workspace anmelden",
          })}
        </SSOAuthButton>
      ) : null}

      {disableEmailPasswordAuthentication ? null : (
        <nav
          className="flex flex-col gap-3 pt-2 text-sm"
          aria-label="Weitere Optionen"
        >
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline text-left nora-touch-target"
            onClick={() => onSwitch("passwort")}
          >
            Passwort vergessen
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline text-left nora-touch-target"
            onClick={() => onSwitch("einladung")}
          >
            Einladung erhalten?
          </button>
        </nav>
      )}
    </div>
  );
};

const ForgotPasswordPanel = ({
  onSwitch,
}: {
  onSwitch: (mode: EmployeeAccessMode) => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const notify = useNotify();

  const handleSubmit: SubmitHandler<FieldValues> = async (values) => {
    setLoading(true);
    try {
      const email = String(values.email ?? "").trim();
      // Always show a neutral confirmation — no account enumeration.
      await getSupabaseClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth-callback.html`,
      });
    } catch {
      // Swallow provider details; confirmation stays neutral.
    } finally {
      setLoading(false);
      setDone(true);
      notify(
        "Wenn ein Zugang zu dieser Adresse existiert, erhalten Sie in Kürze eine E-Mail.",
        {
          type: "info",
          messageArgs: {
            _: "Wenn ein Zugang zu dieser Adresse existiert, erhalten Sie in Kürze eine E-Mail.",
          },
        },
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center lg:text-left">
        <h2 className="text-2xl font-semibold tracking-tight">
          Passwort vergessen
        </h2>
        <p className="text-sm text-muted-foreground">
          Geben Sie Ihre geschäftliche E-Mail-Adresse ein. Falls ein Zugang
          existiert, senden wir Ihnen einen Link zum Zurücksetzen.
        </p>
      </div>

      {done ? (
        <div className="space-y-4" role="status">
          <p className="text-sm text-muted-foreground">
            Wenn ein Zugang zu dieser Adresse existiert, erhalten Sie in Kürze
            eine E-Mail.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full nora-touch-target"
            onClick={() => onSwitch("anmelden")}
          >
            Zurück zur Anmeldung
          </Button>
        </div>
      ) : (
        <Form className="space-y-5" onSubmit={handleSubmit}>
          <TextInput
            label="Geschäftliche E-Mail-Adresse"
            source="email"
            type="email"
            autoComplete="username"
            validate={required()}
          />
          <Button
            type="submit"
            size="lg"
            className="nora-primary-action nora-touch-target w-full"
            disabled={loading}
          >
            Link anfordern
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full nora-touch-target"
            onClick={() => onSwitch("anmelden")}
          >
            Zurück zur Anmeldung
          </Button>
        </Form>
      )}
    </div>
  );
};

const InviteActivationPanel = ({
  onSwitch,
}: {
  onSwitch: (mode: EmployeeAccessMode) => void;
}) => {
  const [loading, setLoading] = useState(false);
  const notify = useNotify();
  const navigate = useNavigate();

  const handleSubmit: SubmitHandler<FieldValues> = async (values) => {
    setLoading(true);
    try {
      const email = String(values.email ?? "").trim();
      const token = String(values.invite_code ?? "").trim();

      const { error } = await getSupabaseClient().auth.verifyOtp({
        email,
        token,
        type: "invite",
      });

      if (error) {
        notify(
          "Die Einladung konnte nicht bestätigt werden. Bitte prüfen Sie den Link in Ihrer E-Mail oder fordern Sie eine neue Einladung an.",
          {
            type: "error",
            messageArgs: {
              _: "Die Einladung konnte nicht bestätigt werden. Bitte prüfen Sie den Link in Ihrer E-Mail oder fordern Sie eine neue Einladung an.",
            },
          },
        );
        return;
      }

      navigate("/set-password");
    } catch {
      notify(
        "Die Einladung konnte nicht bestätigt werden. Bitte prüfen Sie den Link in Ihrer E-Mail oder fordern Sie eine neue Einladung an.",
        {
          type: "error",
          messageArgs: {
            _: "Die Einladung konnte nicht bestätigt werden. Bitte prüfen Sie den Link in Ihrer E-Mail oder fordern Sie eine neue Einladung an.",
          },
        },
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center lg:text-left">
        <h2 className="text-2xl font-semibold tracking-tight">
          Einladung aktivieren
        </h2>
        <p className="text-sm text-muted-foreground">
          Der sicherste Weg ist der Link in Ihrer Einladungs-E-Mail. Optional
          können Sie E-Mail-Adresse und Einmalcode aus der Einladung eingeben.
        </p>
      </div>

      <Form className="space-y-5" onSubmit={handleSubmit}>
        <TextInput
          label="Geschäftliche E-Mail-Adresse"
          source="email"
          type="email"
          autoComplete="username"
          validate={required()}
        />
        <TextInput
          label="Einmalcode aus der Einladung"
          source="invite_code"
          autoComplete="one-time-code"
          validate={required()}
        />
        <Button
          type="submit"
          size="lg"
          className="nora-primary-action nora-touch-target w-full"
          disabled={loading}
        >
          Einladung prüfen
        </Button>
      </Form>

      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          Keinen Code? Öffnen Sie den Link in Ihrer Einladungs-E-Mail – er führt
          Sie direkt zur Passwortvergabe.
        </p>
        <button
          type="button"
          className="text-foreground underline-offset-4 hover:underline nora-touch-target"
          onClick={() => onSwitch("anmelden")}
        >
          Zurück zur Anmeldung
        </button>
      </div>
    </div>
  );
};

/** Kept for callers that still import LoginPage directly. */
export const LoginPage = (props: { redirectTo?: string }) => (
  <StartPage redirectTo={props.redirectTo} />
);

LoginPage.path = "/login";
export const LOGIN_FORM_SEARCH = "mode=anmelden";

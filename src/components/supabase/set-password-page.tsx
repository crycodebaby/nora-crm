import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { ValidateForm } from "ra-core";
import {
  FieldTitle,
  Form,
  required,
  useInput,
  useNotify,
  useTranslate,
} from "ra-core";
import type { FieldValues, SubmitHandler } from "react-hook-form";
import { Eye, EyeOff } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";
import { BooleanInput } from "@/components/admin/boolean-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TextInput } from "@/components/admin/text-input";
import {
  FormControl,
  FormError,
  FormField,
  FormLabel,
} from "@/components/admin/form";
import { InputHelperText } from "@/components/admin/input-helper-text";
import { EmployeeAccessShell } from "@/components/atomic-crm/login/EmployeeAccessShell";
import {
  INITIAL_ONBOARDING_STATE,
  ONBOARDING_PROGRESS_STEPS,
  onboardingReducer,
  progressIndexOf,
  type OnboardingStep,
} from "@/components/atomic-crm/login/employeeOnboardingFlow";
import {
  clearPasswordSetMark,
  hasPasswordBeenSet,
  markPasswordSet,
} from "@/components/atomic-crm/login/passwordSetupMarker";
import { normalizePersonName } from "@/components/atomic-crm/misc/personName";
import { setCurrentSaleCache } from "@/components/atomic-crm/providers/supabase/authProvider";
import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

const PASSWORD_GUIDANCE =
  "Empfohlen: mindestens 12 Zeichen. Verwenden Sie kein leicht erratbares Passwort.";

interface PasswordInputProps {
  label: string;
  source: string;
  autoComplete?: string;
  validate?: Parameters<typeof useInput>[0]["validate"];
  helperText?: string;
}

/**
 * Password field with a show/hide toggle. Each instance keeps its own
 * visibility state, so the password and confirm-password fields never
 * share a reveal state.
 */
const PasswordInput = ({
  label,
  source,
  autoComplete,
  validate,
  helperText,
}: PasswordInputProps) => {
  const [visible, setVisible] = useState(false);
  const { id, field, isRequired } = useInput({ source, validate });

  return (
    <FormField id={id} name={field.name}>
      <FormLabel>
        <FieldTitle label={label} source={source} isRequired={isRequired} />
      </FormLabel>
      <div className="relative">
        <FormControl>
          <Input
            {...field}
            type={visible ? "text" : "password"}
            autoComplete={autoComplete}
            className="pr-10"
          />
        </FormControl>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Passwort ausblenden" : "Passwort anzeigen"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <InputHelperText helperText={helperText} />
      <FormError />
    </FormField>
  );
};

/**
 * Maps known Supabase auth failures during password setup to calm,
 * actionable German copy. Never surfaces raw provider payloads or tokens.
 */
export function mapPasswordSetupError(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;

  if (/weak|easy to guess|pwned/i.test(message)) {
    return "Dieses Passwort ist zu leicht zu erraten. Bitte wählen Sie ein längeres und persönlicheres Passwort.";
  }
  if (/too short|should be at least/i.test(message)) {
    return "Das Passwort ist zu kurz. Empfehlung: mindestens 12 Zeichen.";
  }
  if (status === 401 || status === 403 || /session|jwt|token/i.test(message)) {
    return "Dieser Link ist nicht mehr gültig. Bitte fordern Sie einen neuen Link an.";
  }
  return "Das Passwort konnte nicht gesetzt werden. Bitte versuchen Sie es erneut oder fordern Sie eine neue Einladung an.";
}

interface PasswordFormData {
  password: string;
  confirmPassword: string;
  privacyAccepted: boolean;
}

interface ProfileFormData {
  first_name: string;
  last_name: string;
}

/**
 * Greeting identity. Sourced exclusively from the authenticated Supabase user
 * (metadata + login email). URL query parameters are never trusted as identity.
 */
type OnboardingIdentity = {
  firstName: string;
  lastName: string;
  email: string;
};

const EMPTY_IDENTITY: OnboardingIdentity = {
  firstName: "",
  lastName: "",
  email: "",
};

const STEP_LABEL: Record<(typeof ONBOARDING_PROGRESS_STEPS)[number], string> = {
  welcome: "Willkommen",
  password: "Passwort einrichten",
  profile: "Profil bestätigen",
  complete: "Fertig",
};

const Progress = ({ current }: { current: OnboardingStep }) => {
  const currentIndex = progressIndexOf(current);
  return (
    <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Fortschritt">
      {ONBOARDING_PROGRESS_STEPS.map((step, index) => {
        const active = index === currentIndex;
        const done = index < currentIndex;
        return (
          <li key={step} className="min-w-0">
            <div
              className={`h-1 rounded-full ${
                done || active ? "bg-[#2c2c2c]" : "bg-black/10"
              }`}
              aria-hidden
            />
            <p
              className={`mt-2 text-[11px] leading-snug truncate ${
                active ? "text-foreground font-medium" : "text-muted-foreground"
              }`}
            >
              <span className="sr-only">
                {done ? "Erledigt: " : active ? "Aktuell: " : ""}
              </span>
              {STEP_LABEL[step]}
            </p>
          </li>
        );
      })}
    </ol>
  );
};

/** Renders the current step error without leaking provider detail. */
const StepError = ({ message }: { message: string | null }) =>
  message ? (
    <p className="text-sm text-destructive" role="alert">
      {message}
    </p>
  ) : null;

/**
 * Employee onboarding: invitation and password-setup links converge here.
 *
 * Tokens arrive via auth-callback.html → /zugang-einrichten → here, to avoid
 * HashRouter collisions. The Einmalcode (OTP) path arrives with a session
 * already established and no URL tokens. Both enter the same flow.
 *
 * All step transitions go through employeeOnboardingFlow's reducer, so the
 * later premium-UX wave can restyle every screen without touching auth logic.
 */
export const SetPasswordPage = () => {
  const [flow, dispatch] = useReducer(
    onboardingReducer,
    INITIAL_ONBOARDING_STATE,
  );
  const [identity, setIdentity] = useState<OnboardingIdentity>(EMPTY_IDENTITY);

  const location = useLocation();
  const inviteTokens = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      access_token: params.get("access_token"),
      refresh_token: params.get("refresh_token"),
    };
  }, [location.search]);
  const access_token = inviteTokens.access_token;
  const refresh_token = inviteTokens.refresh_token;
  const hasInviteTokens = Boolean(access_token && refresh_token);

  const notify = useNotify();
  const translate = useTranslate();
  const navigate = useNavigate();

  const isSupabaseConfigured = Boolean(
    import.meta.env.VITE_SUPABASE_URL &&
      import.meta.env.VITE_SB_PUBLISHABLE_KEY,
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!isSupabaseConfigured) {
        // Without a configured backend the link itself is the only signal.
        if (!cancelled) {
          dispatch(
            hasInviteTokens
              ? { type: "sessionResolved" }
              : { type: "sessionMissing" },
          );
        }
        return;
      }

      try {
        const client = getSupabaseClient();

        // Establishing the session here (rather than at submit time) is what
        // lets the welcome screen greet the employee truthfully.
        if (hasInviteTokens && access_token && refresh_token) {
          const { error } = await client.auth.setSession({
            access_token,
            refresh_token,
          });
          if (error) throw error;
        }

        const { data } = await client.auth.getUser();
        const user = data.user;

        if (cancelled) return;

        if (!user) {
          dispatch(
            hasInviteTokens
              ? { type: "sessionResolved" }
              : { type: "sessionMissing" },
          );
          return;
        }

        const meta = user.user_metadata ?? {};
        setIdentity({
          firstName: normalizePersonName(meta.first_name),
          lastName: normalizePersonName(meta.last_name),
          email: user.email ?? "",
        });

        // An interrupted run (reload / closed tab) must not restart at WELCOME
        // and imply the password is still unset — it is not.
        if (hasPasswordBeenSet(user.id)) {
          dispatch({ type: "passwordAlreadySet" });
          return;
        }

        dispatch({ type: "sessionResolved" });
      } catch {
        if (!cancelled) {
          dispatch(
            hasInviteTokens
              ? { type: "sessionResolved" }
              : { type: "sessionMissing" },
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [access_token, hasInviteTokens, isSupabaseConfigured, refresh_token]);

  const validatePassword = (values: PasswordFormData) => {
    const errors: Record<string, string> = {};
    if (values.password !== values.confirmPassword) {
      errors.password = "ra-supabase.validation.password_mismatch";
      errors.confirmPassword = "ra-supabase.validation.password_mismatch";
    }
    if (!values.privacyAccepted) {
      errors.privacyAccepted = "Bitte bestätigen Sie den Hinweis.";
    }
    return errors;
  };

  /**
   * Success contract: completion may only follow a password update that
   * genuinely succeeded AND a still-valid, non-disabled employee mapping.
   * A disabled employee is routed to "blocked" and never reaches completion.
   */
  const submitPassword = useCallback(
    async (values: PasswordFormData) => {
      dispatch({ type: "onPasswordSubmit" });

      try {
        const client = getSupabaseClient();

        // Defensive: the bootstrap normally established the session already.
        if (hasInviteTokens && access_token && refresh_token) {
          const { data: sessionData } = await client.auth.getSession();
          if (!sessionData.session) {
            const { error: sessionError } = await client.auth.setSession({
              access_token,
              refresh_token,
            });
            if (sessionError) throw sessionError;
          }
        }

        const { error } = await client.auth.updateUser({
          password: values.password,
        });
        if (error) throw error;

        const { data } = await client.auth.getUser();
        const user = data.user;
        if (!user) throw new Error("missing user");

        const meta = user.user_metadata ?? {};
        setIdentity({
          firstName: normalizePersonName(meta.first_name),
          lastName: normalizePersonName(meta.last_name),
          email: user.email ?? "",
        });

        // The password is now genuinely changed. Record that before any
        // further step can fail, so an interruption cannot misreport it.
        markPasswordSet(user.id);

        const { data: sale } = await client
          .from("sales")
          .select("id, disabled")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!sale || sale.disabled) {
          dispatch({ type: "accessBlocked" });
          return;
        }

        dispatch({ type: "passwordSucceeded" });
      } catch (error) {
        const message = mapPasswordSetupError(error);
        dispatch({ type: "passwordFailed", error: message });
        notify(message, { type: "error", messageArgs: { _: message } });
      }
    },
    [access_token, hasInviteTokens, notify, refresh_token],
  );

  const submitProfile = useCallback(
    async (values: ProfileFormData) => {
      dispatch({ type: "onProfileSubmit" });

      try {
        const client = getSupabaseClient();
        const first_name = String(values.first_name ?? "").trim();
        const last_name = String(values.last_name ?? "").trim();

        const { error: metaError } = await client.auth.updateUser({
          data: { first_name, last_name },
        });
        if (metaError) throw metaError;

        const { data: sessionData } = await client.auth.getUser();
        const userId = sessionData.user?.id;
        if (!userId) throw new Error("missing user");

        const { data: sale, error: saleError } = await client
          .from("sales")
          .update({ first_name, last_name })
          .eq("user_id", userId)
          .select(
            "id, first_name, last_name, avatar, administrator, role, disabled",
          )
          .single();
        if (saleError || !sale) throw saleError ?? new Error("missing sale");

        if (sale.disabled) {
          dispatch({ type: "accessBlocked" });
          return;
        }

        // Keep header identity in sync once the user enters the app.
        setCurrentSaleCache(sale);

        // Role is never writable from the client — omit intentionally.
        await client.auth.refreshSession();
        // Run finished: a later password-setup link must start at WELCOME.
        clearPasswordSetMark();
        dispatch({ type: "profileSucceeded" });
      } catch {
        const message =
          "Das Profil konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.";
        dispatch({ type: "profileFailed", error: message });
        notify(message, { type: "error", messageArgs: { _: message } });
      }
    },
    [notify],
  );

  if (flow.step === "checking") {
    return (
      <EmployeeAccessShell mode="einladung">
        <Progress current="welcome" />
        <p className="text-sm text-muted-foreground">Einladung wird geprüft…</p>
      </EmployeeAccessShell>
    );
  }

  if (flow.step === "invalid") {
    return (
      <EmployeeAccessShell mode="einladung">
        <Progress current="welcome" />
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Einladung ungültig oder abgelaufen
          </h2>
          <p className="text-sm text-muted-foreground">
            Der Link ist nur einmal und nur begrenzt gültig — er kann auch durch
            eine automatische E-Mail-Prüfung Ihres Systems bereits verbraucht
            worden sein. Bitte fordern Sie bei Ihrer Administration einen neuen
            Einladungs- oder Passwortlink an.
          </p>
          <Button asChild className="w-full nora-touch-target">
            <Link to="/login?mode=einladung">Zur Aktivierung</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full nora-touch-target">
            <Link to="/login?mode=anmelden">Zur Anmeldung</Link>
          </Button>
        </div>
      </EmployeeAccessShell>
    );
  }

  if (flow.step === "blocked") {
    return (
      <EmployeeAccessShell mode="einladung">
        <div className="space-y-4" role="status">
          <h2 className="text-2xl font-semibold tracking-tight">
            Zugang nicht verfügbar
          </h2>
          <p className="text-sm text-muted-foreground">
            Für diese Adresse ist derzeit kein Nora-Zugang aktiv. Bitte wenden
            Sie sich an Ihre Administration.
          </p>
          <Button asChild variant="ghost" className="w-full nora-touch-target">
            <Link to="/login?mode=anmelden">Zur Anmeldung</Link>
          </Button>
        </div>
      </EmployeeAccessShell>
    );
  }

  if (flow.step === "complete") {
    return (
      <EmployeeAccessShell mode="einladung">
        <Progress current="complete" />
        <div
          className="space-y-4 text-center lg:text-left"
          role="status"
          data-testid="onboarding-complete"
        >
          <h2 className="text-2xl font-semibold tracking-tight">
            Zugang eingerichtet
          </h2>
          <p className="text-sm text-muted-foreground">
            Ihr persönliches Passwort ist gespeichert. Sie können sich ab jetzt
            mit {identity.email || "Ihrer geschäftlichen E-Mail-Adresse"}{" "}
            anmelden.
          </p>
          <Button
            type="button"
            className="w-full nora-primary-action nora-touch-target"
            onClick={() => navigate("/")}
          >
            Weiter zu Nora
          </Button>
        </div>
      </EmployeeAccessShell>
    );
  }

  if (flow.step === "profile") {
    return (
      <EmployeeAccessShell mode="einladung">
        <Progress current="profile" />
        <div className="space-y-6">
          <div className="space-y-2 text-center lg:text-left">
            <h2 className="text-2xl font-semibold tracking-tight">
              Profil bestätigen
            </h2>
            <p className="text-sm text-muted-foreground">
              Ihr Passwort ist bereits gespeichert. Prüfen Sie zum Abschluss
              Vor- und Nachname. Ihre Rolle wird ausschließlich von der
              Administration festgelegt.
            </p>
          </div>
          <StepError message={flow.error} />
          <Form<ProfileFormData>
            className="space-y-5"
            onSubmit={submitProfile as SubmitHandler<FieldValues>}
            defaultValues={{
              first_name: identity.firstName,
              last_name: identity.lastName,
            }}
          >
            <TextInput
              label="Vorname"
              source="first_name"
              autoComplete="given-name"
              validate={required()}
            />
            <TextInput
              label="Nachname"
              source="last_name"
              autoComplete="family-name"
              validate={required()}
            />
            <Button
              type="submit"
              className="w-full nora-primary-action nora-touch-target"
              disabled={flow.submitting}
            >
              Speichern und abschließen
            </Button>
          </Form>
        </div>
      </EmployeeAccessShell>
    );
  }

  if (flow.step === "welcome") {
    return (
      <EmployeeAccessShell mode="einladung">
        <Progress current="welcome" />
        <div className="space-y-6">
          <div className="space-y-2 text-center lg:text-left">
            <h2 className="text-2xl font-semibold tracking-tight">
              {identity.firstName
                ? `Hallo ${identity.firstName}`
                : "Willkommen bei Nora"}
            </h2>
            {/* Deliberately makes no claim about the password — it is not set yet. */}
            <p className="text-sm text-muted-foreground">
              Richten Sie jetzt Ihren persönlichen Nora-Zugang ein. Im nächsten
              Schritt vergeben Sie Ihr eigenes Passwort.
            </p>
            {identity.email ? (
              <p className="text-sm text-muted-foreground">
                Ihre Anmeldeadresse für Nora:{" "}
                <span className="font-medium text-foreground">
                  {identity.email}
                </span>
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            className="w-full nora-primary-action nora-touch-target"
            onClick={() => dispatch({ type: "onContinue" })}
          >
            Zugang einrichten
          </Button>
        </div>
      </EmployeeAccessShell>
    );
  }

  return (
    <EmployeeAccessShell mode="einladung">
      <Progress current="password" />
      <div className="space-y-6">
        <div className="space-y-2 text-center lg:text-left">
          <h2 className="text-2xl font-semibold tracking-tight">
            {translate("ra-supabase.set_password.new_password", {
              _: "Neues Passwort festlegen",
            })}
          </h2>
          <p className="text-sm text-muted-foreground">
            Wählen Sie ein persönliches Passwort. Gemeinsame Konten sind nicht
            zulässig.
          </p>
        </div>
        <StepError message={flow.error} />
        <Form<PasswordFormData>
          className="space-y-5"
          onSubmit={submitPassword as SubmitHandler<FieldValues>}
          validate={validatePassword as ValidateForm}
          defaultValues={{ privacyAccepted: false }}
        >
          <PasswordInput
            label="Passwort"
            autoComplete="new-password"
            source="password"
            validate={required()}
            helperText={PASSWORD_GUIDANCE}
          />
          <PasswordInput
            label="Passwort bestätigen"
            source="confirmPassword"
            autoComplete="new-password"
            validate={required()}
          />
          <BooleanInput
            source="privacyAccepted"
            label="Ich bestätige, dass ich diesen Zugang ausschließlich persönlich und für dienstliche Zwecke nutze."
          />
          <Button
            type="submit"
            className="w-full nora-primary-action nora-touch-target"
            disabled={flow.submitting}
          >
            Passwort speichern
          </Button>
          {/* Allowed only before the password succeeds — the reducer ignores
              this event from PROFILE, COMPLETE and BLOCKED. */}
          <Button
            type="button"
            variant="ghost"
            className="w-full nora-touch-target"
            disabled={flow.submitting}
            onClick={() => dispatch({ type: "onBack" })}
          >
            Zurück
          </Button>
        </Form>
      </div>
    </EmployeeAccessShell>
  );
};

SetPasswordPage.path = "set-password";

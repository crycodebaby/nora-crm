import { useEffect, useMemo, useState } from "react";
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
import { normalizePersonName } from "@/components/atomic-crm/misc/personName";
import { setCurrentSaleCache } from "@/components/atomic-crm/providers/supabase/authProvider";
import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

const PASSWORD_GUIDANCE =
  "Mindestens 12 Zeichen. Verwenden Sie kein leicht erratbares Passwort.";

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
    return "Das Passwort ist zu kurz. Verwenden Sie mindestens 12 Zeichen.";
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

type OnboardingStep = 1 | 2 | 3 | 4;

const STEPS: { step: OnboardingStep; label: string }[] = [
  { step: 1, label: "Einladung prüfen" },
  { step: 2, label: "Zugang absichern" },
  { step: 3, label: "Profil vervollständigen" },
  { step: 4, label: "Abschluss" },
];

const Progress = ({ current }: { current: OnboardingStep }) => (
  <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Fortschritt">
    {STEPS.map(({ step, label }) => {
      const active = step === current;
      const done = step < current;
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
            {label}
          </p>
        </li>
      );
    })}
  </ol>
);

/**
 * Invite / recovery password setup with multi-step onboarding.
 * Tokens arrive via auth-callback.html to avoid HashRouter collisions.
 * OTP activation may already have a session without URL tokens.
 */
export const SetPasswordPage = () => {
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [step, setStep] = useState<OnboardingStep>(2);
  const [profileDefaults, setProfileDefaults] = useState({
    first_name: "",
    last_name: "",
  });

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
  // Tokens: URL query (via auth-callback.html). OTP path: existing session.

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SB_PUBLISHABLE_KEY;
      if (!url || !key) {
        setHasSession(false);
        setBootstrapping(false);
        return;
      }

      try {
        const client = getSupabaseClient();
        const { data } = await client.auth.getSession();
        if (cancelled) return;
        const session = data.session;
        setHasSession(Boolean(session));
        if (session?.user) {
          const meta = session.user.user_metadata ?? {};
          setProfileDefaults({
            first_name: normalizePersonName(meta.first_name),
            last_name: normalizePersonName(meta.last_name),
          });
        }
      } catch {
        if (!cancelled) setHasSession(false);
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (bootstrapping) {
    return (
      <EmployeeAccessShell mode="einladung">
        <Progress current={1} />
        <p className="text-sm text-muted-foreground">Einladung wird geprüft…</p>
      </EmployeeAccessShell>
    );
  }

  if (!hasInviteTokens && !hasSession) {
    return (
      <EmployeeAccessShell mode="einladung">
        <Progress current={1} />
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Einladung ungültig oder abgelaufen
          </h2>
          <p className="text-sm text-muted-foreground">
            Bitte öffnen Sie erneut den Link aus Ihrer Einladungs-E-Mail oder
            fordern Sie bei Ihrer Administration eine neue Einladung an.
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

  const submitPassword = async (values: PasswordFormData) => {
    try {
      setLoading(true);
      const client = getSupabaseClient();

      if (hasInviteTokens && access_token && refresh_token) {
        const { error: sessionError } = await client.auth.setSession({
          access_token,
          refresh_token,
        });
        if (sessionError) throw sessionError;
      }

      const { error } = await client.auth.updateUser({
        password: values.password,
      });
      if (error) throw error;

      const { data } = await client.auth.getUser();
      const meta = data.user?.user_metadata ?? {};
      setProfileDefaults({
        first_name: normalizePersonName(meta.first_name),
        last_name: normalizePersonName(meta.last_name),
      });
      setStep(3);
    } catch (error) {
      const message = mapPasswordSetupError(error);
      notify(message, {
        type: "error",
        messageArgs: { _: message },
      });
    } finally {
      setLoading(false);
    }
  };

  const submitProfile = async (values: ProfileFormData) => {
    try {
      setLoading(true);
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

      // Keep header identity in sync once the user enters the app.
      setCurrentSaleCache(sale);

      // Role is never writable from the client — omit intentionally.
      await client.auth.refreshSession();
      setStep(4);
    } catch {
      notify(
        "Das Profil konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
        {
          type: "error",
          messageArgs: {
            _: "Das Profil konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
          },
        },
      );
    } finally {
      setLoading(false);
    }
  };

  if (step === 4) {
    return (
      <EmployeeAccessShell mode="einladung">
        <Progress current={4} />
        <div className="space-y-4 text-center lg:text-left">
          <h2 className="text-2xl font-semibold tracking-tight">
            Zugang eingerichtet
          </h2>
          <p className="text-sm text-muted-foreground">
            Ihr Zugang ist bereit. Sie werden jetzt zur Anwendung
            weitergeleitet.
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

  if (step === 3) {
    return (
      <EmployeeAccessShell mode="einladung">
        <Progress current={3} />
        <div className="space-y-6">
          <div className="space-y-2 text-center lg:text-left">
            <h2 className="text-2xl font-semibold tracking-tight">
              Profil vervollständigen
            </h2>
            <p className="text-sm text-muted-foreground">
              Prüfen Sie Vor- und Nachname. Ihre Rolle wird ausschließlich von
              der Administration festgelegt.
            </p>
          </div>
          <Form<ProfileFormData>
            className="space-y-5"
            onSubmit={submitProfile as SubmitHandler<FieldValues>}
            defaultValues={profileDefaults}
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
              disabled={loading}
            >
              Speichern und abschließen
            </Button>
          </Form>
        </div>
      </EmployeeAccessShell>
    );
  }

  return (
    <EmployeeAccessShell mode="einladung">
      <Progress current={2} />
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
            disabled={loading}
          >
            Passwort speichern
          </Button>
        </Form>
      </div>
    </EmployeeAccessShell>
  );
};

SetPasswordPage.path = "set-password";

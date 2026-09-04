import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ValidateForm } from "ra-core";
import { Form, required } from "ra-core";
import { useWatch } from "react-hook-form";
import type { FieldValues, SubmitHandler } from "react-hook-form";
import {
  CheckIcon,
  CircleAlertIcon,
  Link2OffIcon,
  LockIcon,
  MailIcon,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/admin/text-input";
import { EmployeeAccessShell } from "@/components/atomic-crm/login/EmployeeAccessShell";
import { AccessStepFold } from "@/components/atomic-crm/login/AccessStepFold";
import {
  COMPLETION_SETTLE_MS,
  COMPLETION_SETTLE_REDUCED_MS,
  prefersReducedMotion,
} from "@/components/atomic-crm/login/accessMotion";
import { greetingFor } from "@/components/atomic-crm/login/onboardingSteps";
import { ConsentCheckbox } from "@/components/atomic-crm/login/ConsentCheckbox";
import { OnboardingProgress } from "@/components/atomic-crm/login/OnboardingProgress";
import { OnboardingSuccessMark } from "@/components/atomic-crm/login/OnboardingSuccessMark";
import { PasswordFieldWithVisibility } from "@/components/atomic-crm/login/PasswordFieldWithVisibility";
import { WaitingDots } from "@/components/atomic-crm/login/WaitingDots";
import {
  INITIAL_ONBOARDING_STATE,
  onboardingReducer,
  type BlockedReason,
  type OnboardingStep,
} from "@/components/atomic-crm/login/employeeOnboardingFlow";
import {
  clearPasswordSetMark,
  hasPasswordBeenSet,
  linkFingerprint,
  markPasswordSet,
} from "@/components/atomic-crm/login/passwordSetupMarker";
import { isNoraDemoMode } from "@/components/atomic-crm/misc/noraDemoMode";
import { normalizePersonName } from "@/components/atomic-crm/misc/personName";
import { DEMO_SALES_BY_ROLE } from "@/components/atomic-crm/providers/fakerest/demoSession";
import { setCurrentSaleCache } from "@/components/atomic-crm/providers/supabase/authProvider";
import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";

/** V1A password contract: a recommendation, not a Nora minimum. Supabase validates. */
const PASSWORD_GUIDANCE =
  "Empfohlen: mindestens 12 Zeichen. Verwenden Sie kein leicht erratbares Passwort.";

const PASSWORD_MISMATCH = "Die Passwörter stimmen nicht überein.";
const CONSENT_REQUIRED = "Bitte bestätigen Sie den Hinweis.";
const PROFILE_SAVE_FAILED =
  "Ihr Passwort ist gespeichert. Der Name konnte gerade nicht gespeichert werden. Bitte versuchen Sie es noch einmal.";

/**
 * Demo mode (FakeRest, `npm run dev:demo`) has no auth backend. So the whole
 * flow can be reviewed visually, the three backend calls are simulated there
 * with a short delay. Optional `?demo=` scenarios: `weak` (password rejected),
 * `blocked`, `unverified`, `profile-error`. Every step still goes through the
 * reducer; production builds never enter these branches.
 */
const DEMO_LATENCY_MS = 700;
const demoWait = () =>
  new Promise<void>((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));

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

/** "Viktoriia P." — the quiet identity line above later step titles. */
function nameLineFor(identity: OnboardingIdentity): string | null {
  if (!identity.firstName) return null;
  const initial = identity.lastName ? ` ${identity.lastName[0]}.` : "";
  return `${identity.firstName}${initial}`;
}

/* ---------------------------------------------------------------------- */
/* Presentation primitives local to this page                              */
/* ---------------------------------------------------------------------- */

const StepTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="nora-access-title" tabIndex={-1} data-access-focus>
    {children}
  </h2>
);

/** Inline provider failure under the action — never a toast, never raw text. */
const StepError = ({ message }: { message: string | null }) =>
  message ? (
    <div className="nora-access-alert" role="alert">
      <CircleAlertIcon aria-hidden="true" />
      <p>{message}</p>
    </div>
  ) : null;

const ActionLabel = ({
  submitting,
  idle,
  busy,
}: {
  submitting: boolean;
  idle: string;
  busy: string;
}) =>
  submitting ? (
    <span key="busy" className="nora-access-action-label">
      {busy}
      <WaitingDots />
    </span>
  ) : (
    <span key="idle" className="nora-access-action-label">
      {idle}
    </span>
  );

/** Quiet confirmation once both password fields agree. Never an error. */
const PasswordMatchStatus = () => {
  const [password, confirm] = useWatch({
    name: ["password", "confirmPassword"],
  }) as [string | undefined, string | undefined];
  if (!password || !confirm || password !== confirm) return null;
  return (
    <p className="nora-access-match" data-testid="password-match">
      <CheckIcon aria-hidden="true" />
      <span>Stimmt überein.</span>
    </p>
  );
};

/* ---------------------------------------------------------------------- */
/* Page                                                                    */
/* ---------------------------------------------------------------------- */

/**
 * Employee onboarding: invitation and password-setup links converge here.
 *
 * Tokens arrive via auth-callback.html → /zugang-einrichten → here, to avoid
 * HashRouter collisions. The Einmalcode path (invitation only) arrives with a
 * session already established and no URL tokens. Both enter the same flow.
 *
 * All step transitions go through employeeOnboardingFlow's reducer (V1A,
 * unchanged). V1B only restyles what each step looks like: the fold between
 * steps, the progress line, the password treatment and the completion mark
 * are presentation — none of them decides which step is shown.
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

  const navigate = useNavigate();
  const demoScenario = isNoraDemoMode
    ? new URLSearchParams(location.search).get("demo")
    : null;

  const isSupabaseConfigured = Boolean(
    import.meta.env.VITE_SUPABASE_URL &&
      import.meta.env.VITE_SB_PUBLISHABLE_KEY,
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (isNoraDemoMode) {
        if (cancelled) return;
        if (!hasInviteTokens) {
          dispatch({ type: "sessionMissing" });
          return;
        }
        const sale = DEMO_SALES_BY_ROLE.office;
        setIdentity({
          firstName: sale.first_name,
          lastName: sale.last_name,
          email: sale.email,
        });
        dispatch({ type: "sessionResolved" });
        return;
      }

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
        if (hasPasswordBeenSet(user.id, linkFingerprint(access_token))) {
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
      errors.confirmPassword = PASSWORD_MISMATCH;
    }
    if (!values.privacyAccepted) {
      errors.privacyAccepted = CONSENT_REQUIRED;
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

      if (isNoraDemoMode) {
        await demoWait();
        if (demoScenario === "blocked" || demoScenario === "unverified") {
          dispatch({
            type: "accessBlocked",
            reason: demoScenario === "blocked" ? "disabled" : "unverified",
          });
          return;
        }
        if (demoScenario === "weak") {
          dispatch({
            type: "passwordFailed",
            error: mapPasswordSetupError({ message: "weak" }),
          });
          return;
        }
        dispatch({ type: "passwordSucceeded" });
        return;
      }

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
        markPasswordSet(user.id, linkFingerprint(access_token));

        const { data: sale, error: saleError } = await client
          .from("sales")
          .select("id, disabled")
          .eq("user_id", user.id)
          .maybeSingle();

        // The password is set either way. Completion still requires a proven,
        // non-disabled employee mapping — but a failed CHECK is not evidence
        // that access is disabled, so the two cases stay distinguishable.
        if (saleError) {
          dispatch({ type: "accessBlocked", reason: "unverified" });
          return;
        }
        if (!sale || sale.disabled) {
          dispatch({ type: "accessBlocked", reason: "disabled" });
          return;
        }

        dispatch({ type: "passwordSucceeded" });
      } catch (error) {
        dispatch({
          type: "passwordFailed",
          error: mapPasswordSetupError(error),
        });
      }
    },
    [access_token, demoScenario, hasInviteTokens, refresh_token],
  );

  const submitProfile = useCallback(
    async (values: ProfileFormData) => {
      dispatch({ type: "onProfileSubmit" });

      if (isNoraDemoMode) {
        await demoWait();
        if (demoScenario === "profile-error") {
          dispatch({ type: "profileFailed", error: PROFILE_SAVE_FAILED });
          return;
        }
        dispatch({ type: "profileSucceeded" });
        return;
      }

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
          dispatch({ type: "accessBlocked", reason: "disabled" });
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
        // Variant B: the password is already saved; only the name failed.
        dispatch({ type: "profileFailed", error: PROFILE_SAVE_FAILED });
      }
    },
    [demoScenario],
  );

  return (
    <EmployeeAccessShell mode="einladung">
      <AccessStepFold stepKey={flow.step}>
        {renderStep({
          step: flow.step,
          blockedReason: flow.blockedReason,
          submitting: flow.submitting,
          error: flow.error,
          identity,
          onContinue: () => dispatch({ type: "onContinue" }),
          onBack: () => dispatch({ type: "onBack" }),
          submitPassword,
          submitProfile,
          validatePassword,
          onEnter: () => navigate("/"),
        })}
      </AccessStepFold>
    </EmployeeAccessShell>
  );
};

SetPasswordPage.path = "set-password";

/* ---------------------------------------------------------------------- */
/* Steps                                                                   */
/* ---------------------------------------------------------------------- */

type StepProps = {
  step: OnboardingStep;
  blockedReason?: BlockedReason;
  submitting: boolean;
  error: string | null;
  identity: OnboardingIdentity;
  onContinue: () => void;
  onBack: () => void;
  submitPassword: (values: PasswordFormData) => Promise<void>;
  submitProfile: (values: ProfileFormData) => Promise<void>;
  validatePassword: (values: PasswordFormData) => Record<string, string>;
  onEnter: () => void;
};

function renderStep(props: StepProps) {
  switch (props.step) {
    case "checking":
      return <CheckingStep />;
    case "invalid":
      return <InvalidStep />;
    case "blocked":
      return (
        <BlockedStep reason={props.blockedReason} identity={props.identity} />
      );
    case "complete":
      return <CompleteStep identity={props.identity} onEnter={props.onEnter} />;
    case "profile":
      return <ProfileStep {...props} />;
    case "password":
      return <PasswordStep {...props} />;
    case "welcome":
    default:
      return <WelcomeStep {...props} />;
  }
}

const CheckingStep = () => (
  <div className="space-y-6" role="status">
    {/* Reserved heading height: the greeting lands here without moving the card. */}
    <div className="nora-access-title" aria-hidden="true">
      &nbsp;
    </div>
    <p className="nora-access-lead flex items-center gap-3">
      <span>Einladung wird geprüft…</span>
      <WaitingDots />
    </p>
  </div>
);

const WelcomeStep = ({ identity, onContinue }: StepProps) => (
  <div className="space-y-6">
    <div className="space-y-3">
      <StepTitle>{greetingFor(identity)}</StepTitle>
      <OnboardingProgress current="welcome" />
    </div>
    <div className="space-y-4">
      {/* Deliberately makes no claim about the password — it is not set yet. */}
      <p className="nora-access-lead">
        Ihr persönlicher Nora-Zugang wird jetzt eingerichtet.
      </p>
      {identity.email ? (
        <p>
          <span className="nora-access-chip" data-testid="onboarding-identity">
            <MailIcon aria-hidden="true" />
            <span>{identity.email}</span>
          </span>
        </p>
      ) : null}
      <p className="nora-access-lead">
        Sie legen ein persönliches Passwort fest und prüfen kurz Ihren Namen.
        Das dauert etwa eine Minute.
      </p>
    </div>
    <Button
      type="button"
      size="lg"
      className="nora-access-action nora-primary-action"
      onClick={onContinue}
    >
      Zugang einrichten
    </Button>
  </div>
);

const PasswordStep = ({
  identity,
  submitting,
  error,
  submitPassword,
  validatePassword,
  onBack,
}: StepProps) => {
  const nameLine = nameLineFor(identity);
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {nameLine ? <p className="nora-access-name">{nameLine}</p> : null}
        <StepTitle>Persönliches Passwort festlegen</StepTitle>
        <OnboardingProgress current="password" />
      </div>
      <p className="nora-access-lead">
        Dieses Passwort gehört nur Ihnen. Sie brauchen es bei jeder Anmeldung.
      </p>
      <Form<PasswordFormData>
        className="space-y-5"
        disableInvalidFormNotification
        onSubmit={submitPassword as SubmitHandler<FieldValues>}
        validate={validatePassword as ValidateForm}
        defaultValues={{ privacyAccepted: false }}
      >
        <PasswordFieldWithVisibility
          label="Passwort"
          autoComplete="new-password"
          source="password"
          validate={required()}
          helperText={PASSWORD_GUIDANCE}
        />
        <PasswordFieldWithVisibility
          label="Passwort wiederholen"
          source="confirmPassword"
          autoComplete="new-password"
          validate={required()}
          status={<PasswordMatchStatus />}
        />
        <ConsentCheckbox
          source="privacyAccepted"
          label="Ich nutze diesen Zugang nur persönlich und dienstlich."
        />
        <div className="space-y-3 pt-1">
          <Button
            type="submit"
            size="lg"
            className="nora-access-action nora-primary-action"
            disabled={submitting}
            aria-busy={submitting || undefined}
          >
            <ActionLabel
              submitting={submitting}
              idle={error ? "Erneut versuchen" : "Passwort speichern"}
              busy="Wird gespeichert…"
            />
          </Button>
          <StepError message={error} />
        </div>
        {/* Allowed only before the password succeeds — the reducer ignores
            this event from PROFILE, COMPLETE and BLOCKED. */}
        <p className="nora-access-link-row flex">
          <button
            type="button"
            className="nora-access-link"
            disabled={submitting}
            onClick={onBack}
          >
            Zurück
          </button>
        </p>
      </Form>
    </div>
  );
};

const ProfileStep = ({
  identity,
  submitting,
  error,
  submitProfile,
}: StepProps) => {
  const nameLine = nameLineFor(identity);
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {nameLine ? <p className="nora-access-name">{nameLine}</p> : null}
        <StepTitle>Bitte prüfen Sie Ihren Namen</StepTitle>
        <OnboardingProgress current="profile" />
        {/* Variant B: the password step is genuinely behind the employee. */}
        <p className="nora-access-match" data-testid="password-saved">
          <CheckIcon aria-hidden="true" />
          <span>Passwort gespeichert.</span>
        </p>
      </div>
      <p className="nora-access-lead">
        So erscheinen Sie für Kolleginnen und Kollegen in Nora. Ihre Rolle legt
        die Administration fest.
      </p>
      <Form<ProfileFormData>
        className="space-y-5"
        disableInvalidFormNotification
        onSubmit={submitProfile as SubmitHandler<FieldValues>}
        defaultValues={{
          first_name: identity.firstName,
          last_name: identity.lastName,
        }}
      >
        <div className="grid gap-5 sm:grid-cols-2">
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
        </div>
        <div className="space-y-3 pt-1">
          <Button
            type="submit"
            size="lg"
            className="nora-access-action nora-primary-action"
            disabled={submitting}
            aria-busy={submitting || undefined}
          >
            <ActionLabel
              submitting={submitting}
              idle={error ? "Erneut versuchen" : "Weiter"}
              busy="Wird gespeichert…"
            />
          </Button>
          <StepError message={error} />
        </div>
      </Form>
    </div>
  );
};

const CompleteStep = ({
  identity,
  onEnter,
}: {
  identity: OnboardingIdentity;
  onEnter: () => void;
}) => {
  const [settled, setSettled] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The choreography only decides how success appears. When it has run, the
  // mark becomes a static drawing and focus lands on the one way forward.
  useEffect(() => {
    const wait = prefersReducedMotion()
      ? COMPLETION_SETTLE_REDUCED_MS
      : COMPLETION_SETTLE_MS;
    const timer = window.setTimeout(() => {
      setSettled(true);
      rootRef.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });
    }, wait);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      ref={rootRef}
      className="nora-access-complete"
      role="status"
      data-testid="onboarding-complete"
      data-settled={settled ? "true" : "false"}
    >
      <OnboardingSuccessMark />
      <h2 className="nora-access-title nora-access-complete-title">
        Ihr Nora-Zugang ist eingerichtet
      </h2>
      <p className="nora-access-lead nora-access-complete-copy">
        Sie melden sich künftig mit
        <span className="nora-access-complete-email">
          {identity.email || "Ihrer geschäftlichen E-Mail-Adresse"}
        </span>
        und Ihrem persönlichen Passwort an.
      </p>
      <Button
        type="button"
        size="lg"
        className="nora-access-action nora-access-complete-action nora-primary-action"
        onClick={onEnter}
      >
        Weiter zu Nora
      </Button>
    </div>
  );
};

/**
 * Invitation and password-setup links land on the same page and, once
 * invalid, cannot be told apart. The copy therefore covers both without
 * blaming the employee. The Einmalcode fallback is offered for the invitation
 * only — that is the one flow the contract proves can consume it.
 */
const InvalidStep = () => (
  <div className="space-y-6">
    <div className="space-y-4">
      <span className="nora-access-state-glyph">
        <Link2OffIcon aria-hidden="true" />
      </span>
      <StepTitle>Dieser Link ist nicht mehr gültig</StepTitle>
    </div>
    <p className="nora-access-lead">
      Zugangslinks funktionieren nur einmal und nur für begrenzte Zeit. Manchmal
      hat auch eine automatische E-Mail-Prüfung den Link bereits geöffnet.
      Bitten Sie Ihre Administration um eine neue Einladung oder einen neuen
      Link zum Einrichten des Passworts.
    </p>
    <div className="space-y-3">
      <Button
        asChild
        size="lg"
        className="nora-access-action nora-primary-action"
      >
        <Link to="/login?mode=anmelden">Zur Anmeldung</Link>
      </Button>
      <p className="nora-access-link-row flex">
        <Link to="/login?mode=einladung" className="nora-access-link">
          Einladung mit Einmalcode aktivieren
        </Link>
      </p>
    </div>
  </div>
);

const BlockedStep = ({
  reason,
  identity,
}: {
  reason?: BlockedReason;
  identity: OnboardingIdentity;
}) => {
  const unverified = reason === "unverified";
  return (
    <div className="space-y-6" role="status">
      <div className="space-y-4">
        <span className="nora-access-state-glyph">
          <LockIcon aria-hidden="true" />
        </span>
        <div className="space-y-2">
          {identity.firstName ? (
            <p className="nora-access-name">{greetingFor(identity)}</p>
          ) : null}
          <StepTitle>
            {unverified
              ? "Zugang konnte nicht geprüft werden"
              : "Ihr Nora-Zugang ist derzeit nicht aktiv"}
          </StepTitle>
        </div>
      </div>
      <p className="nora-access-lead">
        {unverified
          ? "Ihr Passwort ist gespeichert. Ihr Zugang ließ sich gerade nicht prüfen. Bitte melden Sie sich in Kürze mit Ihrem neuen Passwort an oder wenden Sie sich an Ihre Administration."
          : "Bitte wenden Sie sich an Ihre Administration, wenn Sie Nora nutzen sollen."}
      </p>
      <Button
        asChild
        size="lg"
        className="nora-access-action nora-primary-action"
      >
        <Link to="/login?mode=anmelden">Zur Anmeldung</Link>
      </Button>
    </div>
  );
};

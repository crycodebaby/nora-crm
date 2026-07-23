import { useNavigate } from "react-router";
import { EmployeeAccessShell } from "./EmployeeAccessShell";
import { Button } from "@/components/ui/button";

/**
 * Public self-registration is disabled for Nora.
 * First admin is created in Supabase; further users are invited by admins.
 */
export const SignupPage = () => {
  const navigate = useNavigate();

  return (
    <EmployeeAccessShell mode="einladung">
      <div className="space-y-4 text-center lg:text-left">
        <h2 className="text-2xl font-semibold tracking-tight">
          Zugang nur per Einladung
        </h2>
        <p className="text-sm text-muted-foreground">
          Eine öffentliche Registrierung ist nicht möglich. Bitte nutzen Sie den
          Link in Ihrer Einladungs-E-Mail oder den Aktivierungsbereich.
        </p>
        <Button
          type="button"
          className="w-full nora-touch-target"
          onClick={() => navigate("/login?mode=einladung")}
        >
          Zur Aktivierung
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full nora-touch-target"
          onClick={() => navigate("/login?mode=anmelden")}
        >
          Zur Anmeldung
        </Button>
      </div>
    </EmployeeAccessShell>
  );
};

SignupPage.path = "/sign-up";

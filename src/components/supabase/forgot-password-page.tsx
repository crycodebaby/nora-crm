import { useEffect } from "react";
import { useNavigate } from "react-router";
import { EmployeeAccessShell } from "@/components/atomic-crm/login/EmployeeAccessShell";

/**
 * Password recovery lives on the employee access page (`?mode=passwort`).
 * This route keeps legacy links working.
 */
export const ForgotPasswordPage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/login?mode=passwort", { replace: true });
  }, [navigate]);

  return (
    <EmployeeAccessShell mode="passwort">
      <p className="text-sm text-muted-foreground">
        Weiterleitung zum Passwort-Zurücksetzen…
      </p>
    </EmployeeAccessShell>
  );
};

ForgotPasswordPage.path = "forgot-password";

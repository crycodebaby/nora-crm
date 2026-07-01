import { useTranslate } from "ra-core";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

type AuthPageNavProps = {
  variant: "login" | "signup";
  /** Hide sign-up prompt when email/password auth is disabled */
  showSignUp?: boolean;
  /** Login keeps «Zur Startseite» above the form; sign-up shows it here */
  showBackToStart?: boolean;
};

/**
 * Secondary navigation on public auth screens (login / first-user sign-up).
 * Primary form submit stays Nora-red; these links are outline/ghost.
 */
export const AuthPageNav = ({
  variant,
  showSignUp = true,
  showBackToStart = variant === "signup",
}: AuthPageNavProps) => {
  const translate = useTranslate();

  return (
    <nav
      className="flex flex-col gap-3 pt-6 mt-2 border-t border-border"
      aria-label={translate("crm.auth.nav.aria_label", {
        _: "Authentication navigation",
      })}
    >
      {variant === "login" && showSignUp ? (
        <>
          <p className="text-sm text-center text-muted-foreground">
            {translate("crm.auth.nav.no_account_yet")}
          </p>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="nora-secondary-action nora-touch-target w-full border-border"
          >
            <Link to="/sign-up">{translate("crm.auth.nav.sign_up")}</Link>
          </Button>
        </>
      ) : null}

      {variant === "signup" ? (
        <>
          <p className="text-sm text-center text-muted-foreground">
            {translate("crm.auth.nav.already_have_account")}
          </p>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="nora-secondary-action nora-touch-target w-full border-border"
          >
            <Link to="/login">{translate("crm.auth.nav.sign_in")}</Link>
          </Button>
        </>
      ) : null}

      {showBackToStart ? (
        <Button
          asChild
          variant="ghost"
          size="lg"
          className="nora-secondary-action nora-touch-target w-full"
        >
          <Link to="/">{translate("crm.auth.nav.back_to_start")}</Link>
        </Button>
      ) : null}
    </nav>
  );
};

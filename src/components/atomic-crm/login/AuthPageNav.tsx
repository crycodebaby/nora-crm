import { useTranslate } from "ra-core";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

type AuthPageNavProps = {
  variant: "login" | "invite";
  /** Legacy prop — public registration is disabled; ignored. */
  showSignUp?: boolean;
  showBackToStart?: boolean;
};

/**
 * Secondary navigation on public auth screens.
 * Public self-registration is not offered.
 */
export const AuthPageNav = ({
  variant,
  showBackToStart = variant === "invite",
}: AuthPageNavProps) => {
  const translate = useTranslate();

  return (
    <nav
      className="flex flex-col gap-3 pt-6 mt-2 border-t border-border"
      aria-label={translate("crm.auth.nav.aria_label", {
        _: "Authentication navigation",
      })}
    >
      {variant === "login" ? (
        <Button
          asChild
          variant="outline"
          size="lg"
          className="nora-secondary-action nora-touch-target w-full border-border"
        >
          <Link to="/login?mode=einladung">
            {translate("crm.auth.nav.activate_invite", {
              _: "Einladung aktivieren",
            })}
          </Link>
        </Button>
      ) : null}

      {variant === "invite" ? (
        <Button
          asChild
          variant="outline"
          size="lg"
          className="nora-secondary-action nora-touch-target w-full border-border"
        >
          <Link to="/login?mode=anmelden">
            {translate("crm.auth.nav.sign_in", { _: "Anmelden" })}
          </Link>
        </Button>
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

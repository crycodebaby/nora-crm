import { useLocation } from "react-router";

import { LoginPage } from "./LoginPage";
import { NoraLandingPage } from "./NoraLandingPage";

/**
 * React-admin renders `loginPage` exclusively at `/login`.
 * Default: public landing. `?mode=anmelden` (or location state) shows the login form.
 */
export const StartPage = ({ redirectTo }: { redirectTo?: string }) => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const showLogin =
    params.get("mode") === "anmelden" ||
    (location.state as { showLogin?: boolean } | null)?.showLogin === true;

  if (showLogin) {
    return <LoginPage redirectTo={redirectTo} />;
  }

  return <NoraLandingPage redirectTo={redirectTo} />;
};

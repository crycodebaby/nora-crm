import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { EmployeeAccessShell } from "./EmployeeAccessShell";

/**
 * Landing route for every Nora access email (invitation and password setup).
 *
 * public/auth-callback.html moves the Supabase hash fragment into HashRouter
 * query params and sends the browser here. Before this wave that shim pointed
 * at "#/auth-callback", which is react-admin's OWN reserved route for
 * authProvider.handleCallback — Nora does not implement that, so both the
 * invitation link and the password link dead-ended on "Something went wrong".
 * This Nora-owned path is that missing hop and converges the invitation and
 * the recovery path onto the single password-setup experience.
 *
 * The tokens are only forwarded, never inspected or stored here — the session
 * is established in SetPasswordPage, which stays the one place that talks to
 * Supabase Auth. `replace` keeps the token-bearing URL out of history.
 */
export const AccessLinkLandingPage = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const accessToken = params.get("access_token") ?? "";
    const refreshToken = params.get("refresh_token") ?? "";

    const forwarded = new URLSearchParams();
    if (accessToken) forwarded.set("access_token", accessToken);
    if (refreshToken) forwarded.set("refresh_token", refreshToken);

    const search = forwarded.toString();
    navigate(`/set-password${search ? `?${search}` : ""}`, { replace: true });
  }, [location.search, navigate]);

  return (
    <EmployeeAccessShell mode="einladung">
      <p className="text-sm text-muted-foreground" role="status">
        Ihr Nora-Zugang wird vorbereitet…
      </p>
    </EmployeeAccessShell>
  );
};

/** Deliberately NOT "/auth-callback" — that path belongs to react-admin. */
AccessLinkLandingPage.path = "/zugang-einrichten";

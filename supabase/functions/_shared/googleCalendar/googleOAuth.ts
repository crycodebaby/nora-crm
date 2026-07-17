import type { GoogleCalendarEnv } from "./config.ts";

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
};

export type GoogleTokenError = {
  error: string;
  error_description?: string;
};

export const exchangeAuthorizationCode = async (
  env: GoogleCalendarEnv,
  code: string,
  codeVerifier: string,
): Promise<GoogleTokenResponse> => {
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: env.redirectUri,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json();
  if (!response.ok) {
    const err = payload as GoogleTokenError;
    throw new Error(err.error_description || err.error || "token_exchange_failed");
  }

  return payload as GoogleTokenResponse;
};

export const refreshAccessToken = async (
  env: GoogleCalendarEnv,
  refreshToken: string,
): Promise<GoogleTokenResponse> => {
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json();
  if (!response.ok) {
    const err = payload as GoogleTokenError;
    const message = err.error_description || err.error || "token_refresh_failed";
    const error = new Error(message);
    (error as Error & { code?: string }).code = err.error;
    throw error;
  }

  return payload as GoogleTokenResponse;
};

export const fetchGoogleEmail = async (
  accessToken: string,
  idToken?: string,
): Promise<string | null> => {
  if (idToken) {
    try {
      const [, payload] = idToken.split(".");
      if (payload) {
        const json = JSON.parse(
          typeof atob === "function"
            ? atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
            : Buffer.from(payload, "base64url").toString("utf8"),
        );
        if (typeof json.email === "string") {
          return json.email;
        }
      }
    } catch {
      // fall through to userinfo
    }
  }

  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return typeof data.email === "string" ? data.email : null;
};

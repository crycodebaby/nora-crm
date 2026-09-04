/**
 * Remembers, for a short window, that this browser already completed the
 * password step of an onboarding run.
 *
 * Why this exists: after `updateUser({ password })` succeeds, the password IS
 * changed. If the employee then reloads or closes the tab before finishing the
 * profile step, a naive restart would drop them back on WELCOME, which reads as
 * "your password is not set yet" — a false statement about their own account.
 *
 * Deliberately minimal: one localStorage entry, scoped to the user id, with a
 * short TTL. It is a truthfulness aid, never an authorization signal — nothing
 * grants access based on it, and the server never reads it.
 *
 * The TTL matters: an interrupted run resumes within minutes, whereas a NEW
 * password-setup link days later must start at WELCOME again. Without expiry a
 * stale marker would permanently hide the password form from that employee.
 */

const STORAGE_KEY = "nora.onboarding.password_set";

/** An interrupted run is resumed within minutes; anything older is a new run. */
export const PASSWORD_MARKER_TTL_MS = 30 * 60 * 1000;

type PasswordMarker = {
  userId: string;
  at: number;
  /** Fingerprint of the link this run belongs to. See linkFingerprint(). */
  link: number;
};

/**
 * Lossy, one-way fingerprint of the access token that opened this run.
 *
 * It exists to separate a RELOAD of the current run (same token, marker
 * applies) from a genuinely NEW setup/recovery link for the same employee
 * (different token, marker must be ignored so the password step is shown).
 * Without it, an employee who received a fresh link inside the TTL would be
 * skipped past the password form and could not set a new password.
 *
 * djb2 over the token: not reversible to the token and never sent anywhere —
 * it only ever has to distinguish one token from another.
 */
export function linkFingerprint(
  accessToken: string | null | undefined,
): number {
  const value = accessToken ?? "";
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return hash;
}

function readStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Private mode / blocked site data — treat as "no marker".
    return null;
  }
}

export function markPasswordSet(
  userId: string,
  link: number,
  now: number = Date.now(),
): void {
  if (!userId) return;
  const storage = readStorage();
  if (!storage) return;
  try {
    const marker: PasswordMarker = { userId, at: now, link };
    storage.setItem(STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // Storage full or unavailable — the flow still works, just without resume.
  }
}

export function clearPasswordSetMark(): void {
  const storage = readStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — absence of the marker is the safe default.
  }
}

/**
 * True only for the same user and inside the TTL. Any parse problem, mismatch
 * or expiry answers false, so the flow falls back to the normal WELCOME start.
 */
export function hasPasswordBeenSet(
  userId: string | null | undefined,
  link: number,
  now: number = Date.now(),
): boolean {
  if (!userId) return false;
  const storage = readStorage();
  if (!storage) return false;

  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;

  try {
    const marker = JSON.parse(raw) as Partial<PasswordMarker>;
    if (
      typeof marker?.userId !== "string" ||
      typeof marker?.at !== "number" ||
      typeof marker?.link !== "number"
    ) {
      return false;
    }
    if (marker.userId !== userId) return false;
    // A different link is a new setup intent, even inside the TTL.
    if (marker.link !== link) return false;
    return now - marker.at < PASSWORD_MARKER_TTL_MS;
  } catch {
    return false;
  }
}

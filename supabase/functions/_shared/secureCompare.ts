/**
 * Constant-time string comparison for authenticating webhook secrets.
 *
 * A plain `a !== b` on a secret returns as soon as the first differing byte is
 * found, which leaks — through response timing — how much of the secret an
 * attacker has guessed so far. Both sides are hashed to a fixed 32-byte digest
 * first, so comparisons of different-length inputs cost the same and the loop
 * never short-circuits.
 *
 * The `brevo-email-events` function carries an equivalent local copy; keep the
 * two in sync if you change the algorithm.
 */
const encoder = new TextEncoder();

export async function secureEquals(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);

  const viewA = new Uint8Array(digestA);
  const viewB = new Uint8Array(digestB);

  let diff = 0;
  for (let i = 0; i < viewA.length; i++) {
    diff |= viewA[i] ^ viewB[i];
  }
  return diff === 0;
}

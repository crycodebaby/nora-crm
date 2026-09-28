/**
 * Returns a URL only if it is safe to place in an anchor `href`.
 *
 * A stored field value (a contact's website, a LinkedIn URL, an imported link)
 * is attacker-controllable. Rendering it directly as `href` lets a value like
 * `javascript:...` execute in the signed-in user's context on click — a stored
 * XSS. This helper allows only navigable schemes and rejects everything else.
 *
 * Rules:
 *   - `http:`, `https:`, `mailto:`, `tel:` are allowed.
 *   - `javascript:`, `data:`, `vbscript:`, `file:`, … are rejected (returns
 *     `undefined`, so the caller renders no link).
 *   - Relative / same-origin links (`/`, `#`, `?`) pass through unchanged.
 *   - A bare host without a scheme (`example.com`, `www.foo.de/x`) is upgraded
 *     to `https://`.
 *   - Protocol-relative (`//host`) is upgraded to `https:`.
 *
 * Returns `undefined` for unsafe or empty input so the caller can decide how to
 * render the missing link.
 */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function safeHref(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  const value = String(raw).trim();
  if (value === "") return undefined;

  // Same-origin relative links are always safe.
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (value.startsWith("#") || value.startsWith("?")) return value;

  // Protocol-relative → force https.
  if (value.startsWith("//")) return `https:${value}`;

  // Absolute URL with an explicit scheme: allow only the safe ones.
  try {
    const url = new URL(value);
    return SAFE_PROTOCOLS.has(url.protocol) ? value : undefined;
  } catch {
    // No parseable scheme. If a colon appears before any slash the input is
    // trying to smuggle a scheme (e.g. `javascript:alert(1)`): reject it.
    const colon = value.indexOf(":");
    const slash = value.indexOf("/");
    if (colon !== -1 && (slash === -1 || colon < slash)) return undefined;
    // Otherwise treat it as a bare host and upgrade to https.
    return `https://${value}`;
  }
}

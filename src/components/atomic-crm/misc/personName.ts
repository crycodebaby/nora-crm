/**
 * DB/auth bootstrap uses "Pending" when no first/last name was provided at invite time.
 * Treat that sentinel as empty in editable forms so users don't think it's their name.
 */
export function normalizePersonName(
  value: string | null | undefined,
): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === "pending") return "";
  return trimmed;
}

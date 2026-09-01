/**
 * Regionale Standardwerte für NEU angelegte Kunden (Customer Create Speed &
 * Clarity Wave, 2026-09-01).
 *
 * Ergart arbeitet praktisch ausschließlich regional in Deutschland, vor allem
 * in Nordrhein-Westfalen. Das Büro soll den Standardfall nicht mehr eintippen.
 *
 * Gilt ausschließlich für den CREATE-Flow (/kunden/create). Bestehende Kunden
 * und der Edit-Flow bleiben unberührt — dort ist der gespeicherte Datensatz
 * die einzige Quelle.
 *
 * `country` ist der bestehende kanonische Freitext-Wert ("Deutschland"): so im
 * Demo-Seed (noraDemoSeed.ts) und als einziger gepflegter Wert in den
 * Produktionsdaten. Keine neue Repräsentation (kein ISO-Code, keine Enum).
 *
 * `state_abbr` bleibt ein frei editierbares Textfeld; "NRW" ist die
 * Product-Owner-Vorgabe und deckt sich mit allen gepflegten Bestandswerten.
 */
export const DEFAULT_CUSTOMER_COUNTRY = "Deutschland";
export const DEFAULT_CUSTOMER_STATE_ABBR = "NRW";

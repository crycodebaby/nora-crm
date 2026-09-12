/**
 * Nora's browser-persistence boundary for the React Query business cache.
 *
 * Product decision (SEC-B2): Nora offers no persistent offline reading of
 * business data. Business data from normal CRM queries lives in the in-memory
 * QueryClient of the running application only and is never dehydrated into
 * browser storage.
 *
 * Until SEC-B2 the mobile surface wrapped its admin in
 * `PersistQueryClientProvider` + `createAsyncStoragePersister({ storage:
 * localStorage })` — inherited from Atomic CRM upstream, never a deliberate
 * Nora decision. Without an explicit key that persister used the library
 * default below, so any successful query (contacts, companies, deals, tasks,
 * notes, sales, audit events, identity/permissions) could end up in the local
 * browser profile. Removing the provider stops new writes; existing browser
 * profiles still hold the old snapshot, which is what the purge below deletes.
 *
 * Security contract: docs/nora/22-security-and-access.md.
 */

/**
 * The key the removed persister wrote: the `@tanstack/query-*-storage-persister`
 * library default, never a Nora-chosen name. This module is its single owner —
 * the constant exists so the legacy snapshot can be deleted, not so anything
 * can write it again.
 */
export const LEGACY_REACT_QUERY_PERSIST_KEY = "REACT_QUERY_OFFLINE_CACHE";

/**
 * Removes the legacy persisted React Query business cache from this browser
 * profile.
 *
 * Deliberately narrow: exactly one known key, nothing else — no
 * `localStorage.clear()`, no prefix or wildcard sweep. Supabase auth storage,
 * Quick Capture drafts, the `RaStoreCRM` preferences and the PWA session state
 * share this storage and must survive byte-identically.
 *
 * Idempotent and safe when the key is absent (`removeItem` on a missing key is
 * a no-op), and safe when storage is unavailable or throws (private mode,
 * blocked site data) — a failed cleanup must never make Nora unusable. Because
 * nothing writes the key any more, there is no need to remember that the purge
 * already ran; it may simply run on every app start.
 */
export const purgeLegacyReactQueryPersistence = (): void => {
  try {
    localStorage.removeItem(LEGACY_REACT_QUERY_PERSIST_KEY);
  } catch {
    // Storage unavailable (private mode, blocked site data) — ignore.
  }
};

/**
 * Stable React identity for one file value in an edit list.
 *
 * Nora file values share the `{ path, src, title, type, rawFile }` shape. A
 * persisted file is identified by its storage key (`path`) — never by `src`,
 * which is optional in the stored grammar and, for a private attachment, not
 * the identity at all (W8-E). A file picked in this session has no key yet and
 * is identified by its local object URL, which is unique per pick. The list
 * position is only the last resort: keying by position hands one file's
 * component state — a derived access URL and its bounded retry budget — to
 * its neighbour after a removal.
 *
 * The prefixes keep the three namespaces from ever colliding.
 */
export const fileListKey = (file: unknown, index: number): string => {
  if (file != null && typeof file === "object") {
    const { path, src } = file as { path?: unknown; src?: unknown };
    if (typeof path === "string" && path.length > 0) return `path:${path}`;
    if (typeof src === "string" && src.length > 0) return `src:${src}`;
  }
  return `index:${index}`;
};

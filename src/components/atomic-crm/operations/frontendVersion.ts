/**
 * Reproducible frontend build identity for Error Observatory.
 * Prefer Vercel / CI commit SHA; never a manually bumped product version.
 */

declare global {
  interface ImportMetaEnv {
    readonly VITE_NORA_FRONTEND_VERSION?: string;
  }
}

const FALLBACK = "dev";

/**
 * Returns a short, non-secret build identifier suitable for operation_errors.frontend_version.
 */
export const getNoraFrontendVersion = (): string => {
  const fromEnv =
    typeof import.meta !== "undefined"
      ? import.meta.env?.VITE_NORA_FRONTEND_VERSION
      : undefined;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv.trim().slice(0, 64);
  }
  return FALLBACK;
};

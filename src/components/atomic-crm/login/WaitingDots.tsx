/**
 * Three dots cycling over opacity — the one thing on the access surface that
 * is allowed to loop, and only while something is genuinely in progress
 * (checking the link, a request in flight). Decorative: the text next to it
 * carries the meaning, so screen readers never hear a second announcement.
 */
export const WaitingDots = ({ className }: { className?: string }) => (
  <span
    className={className ? `nora-wait-dots ${className}` : "nora-wait-dots"}
    aria-hidden="true"
    data-testid="nora-wait-dots"
  >
    <span className="nora-wait-dot" />
    <span className="nora-wait-dot" />
    <span className="nora-wait-dot" />
  </span>
);

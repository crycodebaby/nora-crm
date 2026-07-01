/** Read-only display for KD-/VG- business numbers */
export const BusinessNumber = ({ value }: { value?: string | null }) => {
  if (!value) return null;
  return (
    <span className="nora-muted text-xs font-mono tabular-nums tracking-tight">
      {value}
    </span>
  );
};

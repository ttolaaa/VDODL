type ProgressBarProps = {
  /** 0-100. Ignored when `indeterminate` is set. */
  value: number;
  tone: "action" | "go";
  indeterminate?: boolean;
  label?: string;
};

const TONE_CLASS: Record<ProgressBarProps["tone"], string> = {
  action: "bg-action",
  go: "bg-go",
};

export function ProgressBar({ value, tone, indeterminate = false, label }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      className="relative h-3 w-full overflow-hidden border-2 border-ink bg-white"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
    >
      {indeterminate ? (
        <div className={`vdodl-sweep h-full w-1/3 ${TONE_CLASS[tone]}`} />
      ) : (
        <div
          className={`h-full transition-[width] duration-300 ease-out ${TONE_CLASS[tone]}`}
          style={{ width: `${clamped}%` }}
        />
      )}
    </div>
  );
}

interface Props {
  queriesRemaining: number;
  total?: number;
}

/**
 * Shows daily AI query usage. Warns at ≤5 remaining; shows "limit reached" at 0.
 */
export function RateLimitBadge({ queriesRemaining, total = 20 }: Props) {
  const used = total - queriesRemaining;
  const isExhausted = queriesRemaining === 0;
  const isWarning = !isExhausted && queriesRemaining <= 5;

  const colorClass = isExhausted
    ? "bg-red-900/40 text-red-400 border-red-800"
    : isWarning
    ? "bg-amber-900/40 text-amber-400 border-amber-800"
    : "bg-slate-800/60 text-slate-400 border-slate-700";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${colorClass}`}
      aria-label={`${used} of ${total} AI queries used today`}
    >
      {isExhausted ? (
        "Daily limit reached"
      ) : (
        <>
          {queriesRemaining} / {total} queries left
        </>
      )}
    </span>
  );
}

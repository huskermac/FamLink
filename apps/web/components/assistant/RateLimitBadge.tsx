interface Props {
  queriesRemaining: number;
  total?: number;
}

export function RateLimitBadge({ queriesRemaining, total = 20 }: Props) {
  const used = total - queriesRemaining;
  const isExhausted = queriesRemaining === 0;
  const isWarning = !isExhausted && queriesRemaining <= 5;

  const style = isExhausted
    ? { background: "rgba(239,68,68,0.1)", color: "var(--color-red-400, #f87171)", border: "1px solid rgba(239,68,68,0.3)" }
    : isWarning
    ? { background: "rgba(245,158,11,0.1)", color: "var(--color-amber-400, #fbbf24)", border: "1px solid rgba(245,158,11,0.3)" }
    : { background: "var(--bg-card)", color: "var(--text-muted)", border: "1px solid var(--border)" };

  return (
    <span
      style={{ ...style, display: "inline-flex", alignItems: "center", gap: "4px", borderRadius: "9999px", padding: "2px 10px", fontSize: "12px", fontWeight: 500 }}
      aria-label={`${used} of ${total} AI queries used today`}
    >
      {isExhausted ? "Daily limit reached" : `${queriesRemaining} / ${total} queries left`}
    </span>
  );
}

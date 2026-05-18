interface Props {
  onSelect: (prompt: string) => void;
}

const PROMPTS = [
  "When is the next family event?",
  "Who hasn't RSVP'd to the upcoming event?",
  "When is Dad's birthday?",
  "Create a family dinner Saturday at 6pm at Mom's"
];

export function SuggestedPrompts({ onSelect }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>Try asking:</p>
      <div className="flex flex-wrap gap-2">
        {PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onSelect(prompt)}
            className="rounded-full px-3 py-1.5 text-xs transition-colors"
            style={{ border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)" }}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

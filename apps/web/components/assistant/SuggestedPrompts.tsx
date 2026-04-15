interface Props {
  onSelect: (prompt: string) => void;
}

const PROMPTS = [
  "When is the next family event?",
  "Who hasn't RSVP'd to the upcoming event?",
  "When is Dad's birthday?",
  "Create a family dinner Saturday at 6pm at Mom's"
];

/**
 * Shown on the assistant page when no messages exist yet.
 */
export function SuggestedPrompts({ onSelect }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-500">Try asking:</p>
      <div className="flex flex-wrap gap-2">
        {PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onSelect(prompt)}
            className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300 hover:border-indigo-600 hover:text-indigo-300 transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

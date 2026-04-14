interface Props {
  person: { name: string; age?: number; dob?: string };
  onClose: () => void;
}

export function BirthdayPopover({ person, onClose }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Birthday"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="rounded-xl border border-purple-700 bg-slate-800 p-6 shadow-xl max-w-xs w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-purple-400 mb-2">
          Birthday
        </p>
        <p className="text-lg font-semibold text-slate-100">
          {person.name}
          {person.age !== undefined ? ` turns ${person.age}` : "'s Birthday"}
          !
        </p>
        {person.dob && (
          <p className="mt-1 text-sm text-slate-400">{person.dob}</p>
        )}
        <button
          onClick={onClose}
          className="mt-4 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

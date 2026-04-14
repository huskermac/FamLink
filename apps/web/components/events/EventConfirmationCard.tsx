import type { AiEventProposal } from "@/lib/api/events";

interface Props {
  proposal: AiEventProposal;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/**
 * Renders a proposed event from the AI assistant and lets the user confirm or
 * cancel. Does NOT call createEvent internally — that is onConfirm's responsibility
 * (required for the AI propose/confirm pattern).
 */
export function EventConfirmationCard({ proposal, onConfirm, onCancel }: Props) {
  return (
    <div className="rounded-lg border border-indigo-700 bg-slate-800/80 p-4 flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-wide text-indigo-400">
        AI Proposal — Event
      </p>
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-slate-100">{proposal.title}</p>
        <p className="text-sm text-slate-400">{formatDateTime(proposal.startAt)}</p>
        {proposal.endAt && (
          <p className="text-sm text-slate-500">Ends: {formatDateTime(proposal.endAt)}</p>
        )}
        {proposal.locationName && (
          <p className="text-sm text-slate-400">{proposal.locationName}</p>
        )}
        {proposal.description && (
          <p className="mt-1 text-sm text-slate-300">{proposal.description}</p>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          Confirm
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-slate-600 px-4 py-1.5 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

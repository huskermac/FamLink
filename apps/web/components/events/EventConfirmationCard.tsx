import type { AiEventProposal } from "@/lib/api/events";

interface Props {
  proposal: AiEventProposal;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

export function EventConfirmationCard({ proposal, onConfirm, onCancel }: Props) {
  return (
    <div style={{ borderRadius: "8px", border: "1px solid var(--accent)", background: "var(--bg-card)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <p style={{ fontSize: "11px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--accent)" }}>
        AI Proposal — Event
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
        <p style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>{proposal.title}</p>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{formatDateTime(proposal.startAt)}</p>
        {proposal.endAt && <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>Ends: {formatDateTime(proposal.endAt)}</p>}
        {proposal.locationName && <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{proposal.locationName}</p>}
        {proposal.description && <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>{proposal.description}</p>}
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={onConfirm}
          className="rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors"
          style={{ background: "var(--accent)" }}
        >
          Confirm
        </button>
        <button
          onClick={onCancel}
          className="rounded-md px-4 py-1.5 text-sm font-medium transition-colors"
          style={{ border: "1px solid var(--border)", color: "var(--text-secondary)", background: "transparent" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

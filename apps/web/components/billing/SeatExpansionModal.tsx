"use client";

interface SeatExpansionModalProps {
  currentSeats: number;
  newSeats: number;
  immediateCharge: number;
  recurringIncrease: number;
  currency: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SeatExpansionModal({ currentSeats, newSeats, immediateCharge, recurringIncrease, currency, onConfirm, onCancel }: SeatExpansionModalProps) {
  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--surface)", borderRadius: 12, padding: 32, maxWidth: 420, width: "100%" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", marginBottom: 16 }}>Add a Seat?</h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: 8 }}>
          Adding this person will increase your plan from <strong>{currentSeats} seats</strong> to <strong>{newSeats} seats</strong>.
        </p>
        <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>
          Your next bill will include a prorated charge of <strong>{fmt.format(immediateCharge)}</strong>.
          Going forward, your plan will increase by <strong>{fmt.format(recurringIncrease)}/month</strong>.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer" }}>
            Confirm & Add Seat
          </button>
        </div>
      </div>
    </div>
  );
}

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SeatExpansionModal } from "@/components/billing/SeatExpansionModal";

describe("SeatExpansionModal", () => {
  const baseProps = {
    currentSeats: 2,
    newSeats: 3,
    immediateCharge: 4.50,
    recurringIncrease: 9.00,
    currency: "usd",
    onConfirm: vi.fn(),
    onCancel: vi.fn()
  };

  it("renders seat count and charge information", () => {
    render(<SeatExpansionModal {...baseProps} />);
    expect(screen.getByText(/3 seats/i)).toBeInTheDocument();
    expect(screen.getByText(/\$4\.50/i)).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", () => {
    render(<SeatExpansionModal {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(baseProps.onConfirm).toHaveBeenCalled();
  });

  it("calls onCancel when cancel button is clicked", () => {
    render(<SeatExpansionModal {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(baseProps.onCancel).toHaveBeenCalled();
  });
});

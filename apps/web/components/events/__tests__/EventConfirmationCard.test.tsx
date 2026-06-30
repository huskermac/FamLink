import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { EventConfirmationCard } from "@/components/events/EventConfirmationCard";
import type { AiEventProposal } from "@/lib/api/events";

// Verify createEvent is never imported/called by this component
vi.mock("@/lib/api/events", () => ({
  createEvent: vi.fn()
}));

const baseProposal: AiEventProposal = {
  familyId: "fam1",
  title: "Summer BBQ",
  startAt: "2026-07-04T17:00:00.000Z",
  locationName: "Riverside Park"
};

describe("EventConfirmationCard", () => {
  it("renders the proposed event title", () => {
    render(
      <EventConfirmationCard
        proposal={baseProposal}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText("Summer BBQ")).toBeInTheDocument();
  });

  it("renders the proposed event location", () => {
    render(
      <EventConfirmationCard
        proposal={baseProposal}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText("Riverside Park")).toBeInTheDocument();
  });

  it("renders a formatted start time", () => {
    render(
      <EventConfirmationCard
        proposal={baseProposal}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    // The formatted date string should include the year
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("calls onConfirm when Confirm is clicked", async () => {
    const onConfirm = vi.fn();
    render(
      <EventConfirmationCard
        proposal={baseProposal}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    render(
      <EventConfirmationCard
        proposal={baseProposal}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call createEvent internally on confirm", async () => {
    const { createEvent } = await import("@/lib/api/events");
    const onConfirm = vi.fn();
    render(
      <EventConfirmationCard
        proposal={baseProposal}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(createEvent).not.toHaveBeenCalled();
  });
});

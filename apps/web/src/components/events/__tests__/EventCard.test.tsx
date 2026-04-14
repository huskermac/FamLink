import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EventCard } from "@/components/events/EventCard";
import type { EventSummary } from "@/lib/api/events";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  )
}));

const baseEvent: EventSummary = {
  id: "evt1",
  familyGroupId: "fam1",
  title: "Summer BBQ",
  startAt: "2026-07-04T17:00:00.000Z",
  endAt: null,
  locationName: null,
  isBirthdayEvent: false
};

describe("EventCard", () => {
  it("renders event title", () => {
    render(<EventCard event={baseEvent} />);
    expect(screen.getByText("Summer BBQ")).toBeInTheDocument();
  });

  it("renders formatted date", () => {
    render(<EventCard event={baseEvent} />);
    // The date string should be present (formatted via toLocaleDateString)
    const dateEl = screen.getByText(/Jul|July|Sat|Saturday/i);
    expect(dateEl).toBeInTheDocument();
  });

  it("links to correct event detail URL", () => {
    render(<EventCard event={baseEvent} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/events/evt1");
  });

  it("renders location when provided", () => {
    const event = { ...baseEvent, locationName: "Riverside Park" };
    render(<EventCard event={event} />);
    expect(screen.getByText("Riverside Park")).toBeInTheDocument();
  });

  it("renders birthday badge for birthday events", () => {
    const event = { ...baseEvent, isBirthdayEvent: true };
    render(<EventCard event={event} />);
    expect(screen.getByText("Birthday")).toBeInTheDocument();
  });

  it("does not render birthday badge for non-birthday events", () => {
    render(<EventCard event={baseEvent} />);
    expect(screen.queryByText("Birthday")).not.toBeInTheDocument();
  });
});

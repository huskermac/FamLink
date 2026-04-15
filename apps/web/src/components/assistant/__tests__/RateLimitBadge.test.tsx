import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RateLimitBadge } from "@/components/assistant/RateLimitBadge";

describe("RateLimitBadge", () => {
  it("shows remaining and total when queries remain", () => {
    render(<RateLimitBadge queriesRemaining={15} />);
    expect(screen.getByText(/15 \/ 20 queries left/)).toBeInTheDocument();
  });

  it("shows 'Daily limit reached' when 0 queries remain", () => {
    render(<RateLimitBadge queriesRemaining={0} />);
    expect(screen.getByText("Daily limit reached")).toBeInTheDocument();
  });

  it("has warning aria-label when 5 or fewer remain", () => {
    render(<RateLimitBadge queriesRemaining={5} />);
    expect(screen.getByLabelText(/15 of 20/)).toBeInTheDocument();
  });

  it("uses correct aria-label with usage count", () => {
    render(<RateLimitBadge queriesRemaining={12} />);
    expect(screen.getByLabelText("8 of 20 AI queries used today")).toBeInTheDocument();
  });

  it("uses correct aria-label at exhaustion", () => {
    render(<RateLimitBadge queriesRemaining={0} />);
    expect(screen.getByLabelText("20 of 20 AI queries used today")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const mockCount = vi.fn();
vi.mock("@/hooks/useLinkRequestCount", () => ({ useLinkRequestCount: () => mockCount() }));

import { RequestsBadge } from "@/components/nav/RequestsBadge";
import { NAV_ITEMS } from "@/lib/nav";

describe("RequestsBadge", () => {
  it("shows the count when there are pending requests", () => {
    mockCount.mockReturnValue(3);
    render(<RequestsBadge />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders nothing when the count is zero", () => {
    mockCount.mockReturnValue(0);
    const { container } = render(<RequestsBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("NAV_ITEMS", () => {
  it("has a Requests item", () => {
    expect(NAV_ITEMS.some((i) => i.href === "/requests" && i.label === "Requests")).toBe(true);
  });
});

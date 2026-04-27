import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock usePathname — controlled per test
const mockPathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { Breadcrumbs } from "@/components/nav/Breadcrumbs";

describe("Breadcrumbs", () => {
  it("renders nothing on /dashboard", () => {
    mockPathname.mockReturnValue("/dashboard");
    const { container } = render(<Breadcrumbs />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a single crumb for /events", () => {
    mockPathname.mockReturnValue("/events");
    render(<Breadcrumbs />);
    expect(screen.getByText("Events")).toBeInTheDocument();
    // current segment is not a link
    expect(screen.queryByRole("link", { name: "Events" })).not.toBeInTheDocument();
  });

  it("renders linked parent and current leaf for /events/abc123", () => {
    mockPathname.mockReturnValue("/events/abc123");
    render(<Breadcrumbs />);
    const link = screen.getByRole("link", { name: "Events" });
    expect(link).toHaveAttribute("href", "/events");
    expect(screen.getByText("abc123")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "abc123" })).not.toBeInTheDocument();
  });

  it("renders three crumbs for /family/fam1/members/person1", () => {
    mockPathname.mockReturnValue("/family/fam1/members/person1");
    render(<Breadcrumbs />);
    expect(screen.getByRole("link", { name: "Family" })).toHaveAttribute("href", "/family");
    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute("href", "/family/fam1/members");
    expect(screen.getByText("person1")).toBeInTheDocument();
  });

  it("uses SEGMENT_LABELS to humanise known segments", () => {
    mockPathname.mockReturnValue("/assistant");
    render(<Breadcrumbs />);
    expect(screen.getByText("AI Assistant")).toBeInTheDocument();
  });
});

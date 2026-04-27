import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { firstName: "Steve" } }),
}));

// Mock nav config so toggle tests have a populated children array to exercise.
// The real NAV_ITEMS uses children: [] (empty slot markers) which render as plain links.
vi.mock("@/lib/nav", () => ({
  NAV_ITEMS: [
    { label: "Dashboard",    href: "/dashboard", icon: "⊞" },
    { label: "Events",       href: "/events",    icon: "📅", children: [
      { label: "All Events", href: "/events",    icon: "" },
    ]},
    { label: "Family",       href: "/family",    icon: "👨‍👩‍👧", children: [] },
    { label: "Calendar",     href: "/calendar",  icon: "🗓" },
    { label: "AI Assistant", href: "/assistant", icon: "✦" },
  ],
}));

import { Sidebar } from "@/components/nav/Sidebar";

describe("Sidebar", () => {
  it("renders the FamLink logo", () => {
    render(<Sidebar />);
    expect(screen.getByText("FamLink")).toBeInTheDocument();
  });

  it("renders all top-level nav labels", () => {
    render(<Sidebar />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Events")).toBeInTheDocument();
    expect(screen.getByText("Family")).toBeInTheDocument();
    expect(screen.getByText("Calendar")).toBeInTheDocument();
    expect(screen.getByText("AI Assistant")).toBeInTheDocument();
  });

  it("shows the signed-in user's first name", () => {
    render(<Sidebar />);
    expect(screen.getByText("Steve")).toBeInTheDocument();
  });

  it("item with populated children renders as a toggle button", () => {
    render(<Sidebar />);
    // Events has children: [...] — renders as a button
    expect(screen.getByRole("button", { name: /events/i })).toBeInTheDocument();
  });

  it("item with empty children renders as a plain link, not a button", () => {
    render(<Sidebar />);
    // Family has children: [] — renders as a link
    expect(screen.queryByRole("button", { name: /family/i })).not.toBeInTheDocument();
  });

  it("clicking the toggle expands the section", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const eventsToggle = screen.getByRole("button", { name: /events/i });
    await user.click(eventsToggle);
    expect(eventsToggle).toHaveAttribute("aria-expanded", "true");
  });

  it("clicking an expanded toggle collapses the section", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const eventsToggle = screen.getByRole("button", { name: /events/i });
    await user.click(eventsToggle); // expand
    await user.click(eventsToggle); // collapse
    expect(eventsToggle).toHaveAttribute("aria-expanded", "false");
  });
});

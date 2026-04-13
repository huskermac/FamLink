import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FamilyDashboardPage from "@/app/(protected)/family/page";
import type { FamilyMembership } from "@/lib/api/family";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
}));

vi.mock("@/lib/api/family", () => ({
  getMyFamilies: vi.fn(),
}));

import { getMyFamilies } from "@/lib/api/family";
const mockGetMyFamilies = vi.mocked(getMyFamilies);

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const mockMemberships: FamilyMembership[] = [
  {
    familyGroup: {
      id: "fg1",
      name: "The Smiths",
      aiEnabled: false,
      defaultVisibility: "MEMBERS",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    role: "ADMIN",
    joinedAt: "2024-01-01T00:00:00Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FamilyDashboardPage", () => {
  it("renders loading skeletons initially", () => {
    mockGetMyFamilies.mockReturnValue(new Promise(() => {}));
    const { container } = render(<FamilyDashboardPage />, { wrapper });
    expect(screen.getByText("Your Families")).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("renders family cards when data loads", async () => {
    mockGetMyFamilies.mockResolvedValue(mockMemberships);
    render(<FamilyDashboardPage />, { wrapper });
    expect(await screen.findByText("The Smiths")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /the smiths/i });
    expect(link).toHaveAttribute("href", "/family/fg1");
  });

  it("renders empty state when no families", async () => {
    mockGetMyFamilies.mockResolvedValue([]);
    render(<FamilyDashboardPage />, { wrapper });
    expect(
      await screen.findByText("You haven't joined a family yet.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /onboarding/i })).toHaveAttribute("href", "/onboarding");
  });

  it("renders error state when query fails", async () => {
    mockGetMyFamilies.mockRejectedValue(new Error("Network error"));
    render(<FamilyDashboardPage />, { wrapper });
    expect(await screen.findByText(/failed to load families/i)).toBeInTheDocument();
  });
});

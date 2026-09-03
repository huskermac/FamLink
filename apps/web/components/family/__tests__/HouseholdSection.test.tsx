import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue("t") }) }));

const mockUnlink = vi.fn();
vi.mock("@/lib/api/family", () => ({
  getHousehold: vi.fn(),
  getHouseholdAudit: vi.fn(),
  unlinkHousehold: (...a: unknown[]) => mockUnlink(...a)
}));

const queryData: Record<string, unknown> = {};
const invalidate = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey, enabled }: { queryKey: unknown[]; enabled?: boolean }) =>
    ({ data: enabled === false ? undefined : queryData[String(queryKey[0])], isLoading: false }),
  useMutation: ({ mutationFn, onSuccess, onError }: { mutationFn: (v: unknown) => Promise<unknown>; onSuccess?: () => void; onError?: (e: unknown) => void }) => ({
    mutate: async (vars: unknown) => { try { await mutationFn(vars); onSuccess?.(); } catch (e) { onError?.(e); } },
    isPending: false
  }),
  useQueryClient: () => ({ invalidateQueries: invalidate })
}));

import { HouseholdSection } from "@/components/family/HouseholdSection";

beforeEach(() => {
  invalidate.mockClear();
  // Foreign family carries an `id` (viewer is not a member of it). Audit entry carries a foreign
  // actorFamilyGroupId. The render must show names only and never these ids (isolation).
  queryData["household"] = {
    id: "h1", name: "Home",
    linkedFamilies: [{ name: "The Smiths" }, { id: "fam-foreign-999", name: "The Roes" }],
    members: []
  };
  queryData["household-audit"] = {
    entries: [{ id: "a1", actorFamilyGroupId: "fam-foreign-999", actorDisplayName: "Al", actorFamilyName: "The Smiths", action: "RENAMED", changes: {}, createdAt: "2026-09-01T00:00:00Z" }]
  };
});

afterEach(() => {
  // Vitest 4.1.4 rejection-tracking race: resetting a vi.mock-backed fn in beforeEach when a
  // later test rejects it can surface as an unhandled rejection rather than an assertion
  // failure. Resetting here (after each test's assertions have run) avoids that race.
  mockUnlink.mockReset();
});

describe("HouseholdSection", () => {
  it("shows the linked family names and never renders a foreign family id (isolation)", () => {
    render(<HouseholdSection householdId="h1" familyId="fam1" isAdmin />);
    expect(screen.getByText("The Smiths")).toBeInTheDocument();
    expect(screen.getByText("The Roes")).toBeInTheDocument();
    expect(screen.queryByText(/fam-foreign-999/)).toBeNull();
    expect(screen.queryByText(/^h1$/)).toBeNull();
  });

  it("shows an audit entry actor name and action, and never the actor family id", () => {
    render(<HouseholdSection householdId="h1" familyId="fam1" isAdmin />);
    expect(screen.getByText(/Al/)).toBeInTheDocument();
    expect(screen.getByText(/RENAMED/)).toBeInTheDocument();
    expect(screen.queryByText(/fam-foreign-999/)).toBeNull();
  });

  it("hides the Activity view and the unlink control for a non-admin viewer", () => {
    render(<HouseholdSection householdId="h1" familyId="fam1" isAdmin={false} />);
    expect(screen.getByText("The Smiths")).toBeInTheDocument(); // linked families still show
    expect(screen.queryByText(/RENAMED/)).toBeNull(); // no audit
    expect(screen.queryByRole("button", { name: /unlink/i })).toBeNull(); // no unlink
  });

  it("unlinks with the current family id and invalidates the family query", async () => {
    mockUnlink.mockResolvedValue(undefined);
    render(<HouseholdSection householdId="h1" familyId="fam1" isAdmin />);
    await userEvent.click(screen.getByRole("button", { name: /unlink/i }));
    expect(mockUnlink).toHaveBeenCalledWith("h1", { familyGroupId: "fam1" }, expect.anything());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["family", "fam1"] });
  });

  it("shows a destroy confirm on LAST_LINK and destroys on confirm", async () => {
    mockUnlink.mockRejectedValueOnce(new Error("API 409: LAST_LINK"));
    render(<HouseholdSection householdId="h1" familyId="fam1" isAdmin />);
    await userEvent.click(screen.getByRole("button", { name: /unlink/i }));
    const destroyBtn = await screen.findByRole("button", { name: /delete the household/i });
    mockUnlink.mockResolvedValueOnce(undefined);
    await userEvent.click(destroyBtn);
    expect(mockUnlink).toHaveBeenLastCalledWith("h1", { familyGroupId: "fam1", destroy: true }, expect.anything());
  });
});

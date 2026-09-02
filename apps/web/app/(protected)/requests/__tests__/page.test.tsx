import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue("t") }) }));

const mockAccept = vi.fn().mockResolvedValue({ id: "lr1", status: "ACCEPTED", granted: true, resolvedAt: null });
const mockDecline = vi.fn().mockResolvedValue({ id: "lr1", status: "DECLINED", resolvedAt: null });
vi.mock("@/lib/api/linkRequests", () => ({
  getPendingLinkRequests: vi.fn(),
  acceptLinkRequest: (...a: unknown[]) => mockAccept(...a),
  declineLinkRequest: (...a: unknown[]) => mockDecline(...a)
}));

const queryData: Record<string, unknown> = {};
const queryState: { isLoading: boolean } = { isLoading: false };
const invalidate = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({ data: queryData[String(queryKey[0])], isLoading: queryState.isLoading }),
  useMutation: ({ mutationFn, onSuccess }: { mutationFn: (v: unknown) => Promise<unknown>; onSuccess?: () => void }) => ({
    mutate: async (vars: unknown) => { await mutationFn(vars); onSuccess?.(); },
    isPending: false
  }),
  useQueryClient: () => ({ invalidateQueries: invalidate })
}));

import RequestsPage from "../page";

beforeEach(() => {
  mockAccept.mockClear();
  mockDecline.mockClear();
  invalidate.mockClear();
  queryState.isLoading = false;
  queryData["link-requests-pending"] = {
    requests: [
      { id: "lr1", kind: "FAMILY_MEMBERSHIP", direction: "PULL", requestingFamilyName: "The Smiths", targetName: "You", carryHouseholdName: null, notice: "n" }
    ]
  };
});

describe("RequestsPage", () => {
  it("lists the requesting family name and never renders the request id (isolation)", () => {
    render(<RequestsPage />);
    expect(screen.getByText("The Smiths")).toBeInTheDocument();
    expect(screen.queryByText(/lr1/)).toBeNull();
  });

  it("accepts a request and invalidates the pending query key", async () => {
    render(<RequestsPage />);
    await userEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(mockAccept).toHaveBeenCalledWith("lr1", expect.anything());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["link-requests-pending"] });
  });

  it("declines a request", async () => {
    render(<RequestsPage />);
    await userEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(mockDecline).toHaveBeenCalledWith("lr1", expect.anything());
  });

  it("shows the JOIN purpose text", () => {
    queryData["link-requests-pending"] = {
      requests: [{ id: "lr2", kind: "FAMILY_MEMBERSHIP", direction: "JOIN", requestingFamilyName: "The Roes", targetName: "Kim", carryHouseholdName: null, notice: "n" }]
    };
    render(<RequestsPage />);
    expect(screen.getByText(/asks to join The Roes/i)).toBeInTheDocument();
  });

  it("shows the HOUSEHOLD_LINK purpose text and the carry-household line", () => {
    queryData["link-requests-pending"] = {
      requests: [{ id: "lr3", kind: "HOUSEHOLD_LINK", direction: "PULL", requestingFamilyName: "The Roes", targetName: null, targetHouseholdName: "Maple St", carryHouseholdName: "Maple St", notice: "n" }]
    };
    render(<RequestsPage />);
    expect(screen.getByText(/link the household Maple St/i)).toBeInTheDocument();
    expect(screen.getByText(/household Maple St/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no requests", () => {
    queryData["link-requests-pending"] = { requests: [] };
    render(<RequestsPage />);
    expect(screen.getByText(/no pending requests/i)).toBeInTheDocument();
  });

  it("does not show the empty state while loading", () => {
    queryState.isLoading = true;
    queryData["link-requests-pending"] = undefined;
    render(<RequestsPage />);
    expect(screen.queryByText(/no pending requests/i)).toBeNull();
  });
});

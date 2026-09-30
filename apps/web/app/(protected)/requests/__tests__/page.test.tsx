import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  useMutation: ({
    mutationFn,
    onSuccess,
    onError
  }: {
    mutationFn: (v: unknown) => Promise<unknown>;
    onSuccess?: () => void;
    onError?: (e: unknown, v: unknown) => void;
  }) => ({
    mutate: async (vars: unknown) => {
      try {
        await mutationFn(vars);
        onSuccess?.();
      } catch (e) {
        onError?.(e, vars);
      }
    },
    isPending: false
  }),
  useQueryClient: () => ({ invalidateQueries: invalidate })
}));

import RequestsPage from "../page";

const accepted = { id: "lr1", status: "ACCEPTED", granted: true, resolvedAt: null };
const declined = { id: "lr1", status: "DECLINED", resolvedAt: null };

function restoreMutations() {
  mockAccept.mockReset();
  mockDecline.mockReset();
  mockAccept.mockResolvedValue(accepted);
  mockDecline.mockResolvedValue(declined);
}

function twoRequests() {
  queryData["link-requests-pending"] = {
    requests: [
      { id: "lr1", kind: "FAMILY_MEMBERSHIP", direction: "PULL", requestingFamilyName: "The Smiths", targetName: "You", carryHouseholdName: null, notice: "n" },
      { id: "lr2", kind: "FAMILY_MEMBERSHIP", direction: "PULL", requestingFamilyName: "The Roes", targetName: "You", carryHouseholdName: null, notice: "n" }
    ]
  };
}

function cardFor(name: string): HTMLElement {
  let node: HTMLElement | null = screen.getByText(name);
  while (node && node.querySelector("button") === null) {
    node = node.parentElement;
  }
  if (!node) throw new Error(`No card for ${name}`);
  return node;
}

beforeEach(() => {
  invalidate.mockClear();
  queryState.isLoading = false;
  queryData["link-requests-pending"] = {
    requests: [
      { id: "lr1", kind: "FAMILY_MEMBERSHIP", direction: "PULL", requestingFamilyName: "The Smiths", targetName: "You", carryHouseholdName: null, notice: "n" }
    ]
  };
});

afterEach(() => {
  restoreMutations();
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

  it("declines a request and invalidates the pending query key", async () => {
    render(<RequestsPage />);
    await userEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(mockDecline).toHaveBeenCalledWith("lr1", expect.anything());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["link-requests-pending"] });
  });

  it("shows the accept failure on the failed card only, with no id and no API text", async () => {
    twoRequests();
    mockAccept.mockRejectedValueOnce(new Error("API 500: lr1"));
    render(<RequestsPage />);
    await userEvent.click(within(cardFor("The Smiths")).getByRole("button", { name: /accept/i }));
    expect(await within(cardFor("The Smiths")).findByText("Something went wrong. Try again.")).toBeInTheDocument();
    expect(within(cardFor("The Roes")).queryByText("Something went wrong. Try again.")).toBeNull();
    expect(screen.queryByText(/lr1/)).toBeNull();
    expect(screen.queryByText(/API 500/)).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("shows the decline failure on the failed card only", async () => {
    twoRequests();
    mockDecline.mockRejectedValueOnce(new Error("API 500: lr2"));
    render(<RequestsPage />);
    await userEvent.click(within(cardFor("The Roes")).getByRole("button", { name: /decline/i }));
    expect(await within(cardFor("The Roes")).findByText("Something went wrong. Try again.")).toBeInTheDocument();
    expect(within(cardFor("The Smiths")).queryByText("Something went wrong. Try again.")).toBeNull();
    expect(screen.queryByText(/lr2/)).toBeNull();
    expect(screen.queryByText(/API 500/)).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("clears the accept error after a retry succeeds", async () => {
    twoRequests();
    mockAccept.mockRejectedValueOnce(new Error("API 500: lr1"));
    render(<RequestsPage />);
    const acceptButton = within(cardFor("The Smiths")).getByRole("button", { name: /accept/i });
    await userEvent.click(acceptButton);
    expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
    await userEvent.click(acceptButton);
    expect(mockAccept).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.queryByText("Something went wrong. Try again.")).toBeNull();
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["link-requests-pending"] });
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

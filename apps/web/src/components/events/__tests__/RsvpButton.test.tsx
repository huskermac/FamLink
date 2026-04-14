import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RsvpButton } from "@/components/events/RsvpButton";

// Mock Clerk auth
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") })
}));

// Mock TanStack Query — capture the mutate fn so tests can assert on it
const mockMutate = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    mutate: mockMutate,
    isPending: false
  }),
  useQueryClient: () => ({
    cancelQueries: vi.fn(),
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn()
  })
}));

// Mock the API function
vi.mock("@/lib/api/events", () => ({
  updateRsvp: vi.fn().mockResolvedValue({ id: "r1", status: "YES" })
}));

beforeEach(() => {
  mockMutate.mockClear();
});

describe("RsvpButton", () => {
  it("renders Yes, No, and Maybe buttons", () => {
    render(<RsvpButton eventId="evt1" currentStatus={null} />);
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maybe" })).toBeInTheDocument();
  });

  it("calls mutate with YES when Yes is clicked", async () => {
    render(<RsvpButton eventId="evt1" currentStatus={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(mockMutate).toHaveBeenCalledWith("YES");
  });

  it("calls mutate with NO when No is clicked", async () => {
    render(<RsvpButton eventId="evt1" currentStatus={null} />);
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(mockMutate).toHaveBeenCalledWith("NO");
  });

  it("calls mutate with MAYBE when Maybe is clicked", async () => {
    render(<RsvpButton eventId="evt1" currentStatus={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Maybe" }));
    expect(mockMutate).toHaveBeenCalledWith("MAYBE");
  });

  it("marks the active status button as pressed", () => {
    render(<RsvpButton eventId="evt1" currentStatus="YES" />);
    expect(screen.getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "No" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Maybe" })).toHaveAttribute("aria-pressed", "false");
  });

  it("no button is marked active when currentStatus is null", () => {
    render(<RsvpButton eventId="evt1" currentStatus={null} />);
    for (const name of ["Yes", "No", "Maybe"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });
});

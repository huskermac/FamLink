import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";

const mockAccept = vi.fn();
vi.mock("@/lib/api/consent", () => ({ acceptConsentRequest: (...a: unknown[]) => mockAccept(...a) }));

import { ConsentAccept } from "../ConsentAccept";

// Reset in afterEach (not beforeEach): resetting this vi.mock-backed mock before a test that
// later rejects it races the rejection's microtask against Vitest's own mock bookkeeping and
// gets misreported as an unhandled rejection, even though the component's try/catch handles it.
// Resetting after each test avoids the race while still giving every test a clean mock.
afterEach(() => mockAccept.mockReset());

describe("ConsentAccept", () => {
  it("shows an Accept control and no Decline control for a pending request", () => {
    render(<ConsentAccept token="tok1" initialStatus="PENDING" />);
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /decline/i })).toBeNull();
  });

  it("shows the accepted state after a successful accept", async () => {
    mockAccept.mockResolvedValue({ granted: true, status: "ACCEPTED" });
    render(<ConsentAccept token="tok1" initialStatus="PENDING" />);
    await userEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(mockAccept).toHaveBeenCalledWith("tok1");
    expect(await screen.findByText(/you are now a member/i)).toBeInTheDocument();
  });

  it("shows a resolved message when the accept returns not granted", async () => {
    mockAccept.mockResolvedValue({ granted: false, status: "EXPIRED" });
    render(<ConsentAccept token="tok1" initialStatus="PENDING" />);
    await userEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
  });

  it("shows the accepted state up front when the request is already accepted", () => {
    render(<ConsentAccept token="tok1" initialStatus="ACCEPTED" />);
    expect(screen.getByText(/you are now a member/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
  });

  it("shows an error message when the accept call fails, and does not reject", async () => {
    mockAccept.mockRejectedValue(new Error("network"));
    render(<ConsentAccept token="tok1" initialStatus="PENDING" />);
    await userEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    // The Accept control returns so the user can retry.
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });
});

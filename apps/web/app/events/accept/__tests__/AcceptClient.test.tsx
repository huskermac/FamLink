import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AcceptClient } from "../AcceptClient";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue("t") }) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const mockPreview = vi.fn();
const mockAccept = vi.fn().mockResolvedValue({ accepted: true });
const mockDecline = vi.fn().mockResolvedValue({ declined: true });
vi.mock("@/lib/api/events", () => ({
  previewParticipation: (...a: unknown[]) => mockPreview(...a),
  acceptParticipation: (...a: unknown[]) => mockAccept(...a),
  declineParticipation: (...a: unknown[]) => mockDecline(...a)
}));

beforeEach(() => { push.mockClear(); mockPreview.mockReset(); mockAccept.mockClear(); mockDecline.mockClear(); });

describe("AcceptClient", () => {
  it("PENDING: renders summary and accepts", async () => {
    mockPreview.mockResolvedValue({ state: "PENDING", eventId: "e1", eventTitle: "Picnic", role: "PARTICIPANT", invitedByName: "Alice" });
    render(<AcceptClient token="tok1" />);
    expect(await screen.findByText("Picnic")).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^accept$/i }));
    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith("e1", "tok1", expect.anything()));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/e1"));
  });

  it("DECLINED: shows a re-accept nudge with an Accept button", async () => {
    mockPreview.mockResolvedValue({ state: "DECLINED", eventId: "e1", eventTitle: "Picnic", role: "PARTICIPANT", invitedByName: "Alice" });
    render(<AcceptClient token="tok1" />);
    expect(await screen.findByText(/declined/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });

  it("ACTIVE: redirects to the event", async () => {
    mockPreview.mockResolvedValue({ state: "ACTIVE", eventId: "e9" });
    render(<AcceptClient token="tok1" />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/e9"));
  });

  it("UNAVAILABLE: generic message, no event detail", async () => {
    mockPreview.mockResolvedValue({ state: "UNAVAILABLE" });
    render(<AcceptClient token="tok1" />);
    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
  });

  it("decline shows an inline confirmation", async () => {
    mockPreview.mockResolvedValue({ state: "PENDING", eventId: "e1", eventTitle: "Picnic", role: "PARTICIPANT", invitedByName: "Alice" });
    render(<AcceptClient token="tok1" />);
    await screen.findByText("Picnic");
    await userEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(await screen.findByText(/you declined/i)).toBeInTheDocument();
  });
});

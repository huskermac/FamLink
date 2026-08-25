import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InviteStep } from "../InviteStep";

const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: routerReplace }) }));

const mockApiFetch = vi.fn();
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => mockApiFetch(...a) }));

vi.mock("@/lib/api/billing", () => ({
  fetchSubscription: vi.fn(),
  getSeatImpact: vi.fn(),
  createCheckoutSession: vi.fn()
}));

describe("InviteStep", () => {
  const getToken = vi.fn().mockResolvedValue("tok-1");

  beforeEach(() => {
    routerReplace.mockClear();
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue({ id: "person-1" });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "member-1" })
    }) as unknown as typeof fetch;
  });

  it("stamps the new passive person with familyGroupId (POST /api/v1/persons) so the following direct add passes the provenance gate", async () => {
    render(<InviteStep getToken={getToken} familyGroupId="fam-123" />);

    await userEvent.type(screen.getByLabelText(/first name/i), "Alex");
    await userEvent.type(screen.getByLabelText(/email/i), "alex@example.com");
    await userEvent.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    const [path, options] = mockApiFetch.mock.calls[0] as [string, { body: string }];
    expect(path).toBe("/api/v1/persons");
    const body = JSON.parse(options.body);
    // familyGroupId is stamped; the collected email is deliberately NOT sent (kept
    // contact-less — decision 8 data-entry record, no consent bypass).
    expect(body).toEqual({
      firstName: "Alex",
      lastName: "Member",
      ageGateLevel: "ADULT",
      familyGroupId: "fam-123"
    });

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/dashboard"));
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getGuestInvitation, submitGuestRsvp } from "@/lib/api/events";

const originalEnv = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL = originalEnv;
  vi.unstubAllGlobals();
});

function mockFetch(ok: boolean, body: unknown) {
  const text = JSON.stringify(body);
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok,
    json: async () => body,
    text: async () => text
  });
}

describe("getGuestInvitation", () => {
  it("fetches the guest invitation by token and returns parsed data", async () => {
    const payload = {
      event: { id: "e1", title: "Picnic", startAt: "2026-07-04T17:00:00Z", endAt: null, locationName: "Park", familyGroup: { name: "The Smiths" } },
      guestName: "Jane",
      currentStatus: "PENDING"
    };
    mockFetch(true, payload);
    const result = await getGuestInvitation("tok123");
    expect(fetch).toHaveBeenCalledWith("http://localhost:4000/api/v1/guest/invitation/tok123");
    expect(result).toEqual(payload);
  });

  it("uses localhost:4000 as default when NEXT_PUBLIC_API_URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    mockFetch(true, { event: {}, guestName: null, currentStatus: "PENDING" });
    await getGuestInvitation("tok");
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("http://localhost:4000/api/v1/guest/invitation/tok");
  });

  it("throws when the response is not ok", async () => {
    mockFetch(false, {});
    await expect(getGuestInvitation("bad-tok")).rejects.toThrow("Invitation not found");
  });
});

describe("submitGuestRsvp", () => {
  it("POSTs the status to the rsvp route and returns result", async () => {
    mockFetch(true, { ok: true, status: "ACCEPTED" });
    const result = await submitGuestRsvp("tok123", "ACCEPTED");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/guest/invitation/tok123/rsvp",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACCEPTED" })
      })
    );
    expect(result).toEqual({ ok: true, status: "ACCEPTED" });
  });

  it("throws when the RSVP POST fails", async () => {
    mockFetch(false, {});
    await expect(submitGuestRsvp("tok123", "DECLINED")).rejects.toThrow("RSVP failed");
  });
});

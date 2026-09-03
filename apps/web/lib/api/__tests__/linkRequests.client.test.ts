import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getPendingLinkRequests,
  createLinkRequest,
  acceptLinkRequest,
  declineLinkRequest
} from "@/lib/api/linkRequests";

const getToken = () => Promise.resolve("tok");
const originalEnv = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL = originalEnv;
  vi.unstubAllGlobals();
});
function mockFetch(ok: boolean, body: unknown, status = ok ? 200 : 409) {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok, status, json: async () => body, text: async () => JSON.stringify(body)
  });
}

describe("linkRequests client", () => {
  it("GETs the pending list", async () => {
    mockFetch(true, { requests: [] });
    const r = await getPendingLinkRequests(getToken);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/v1/link-requests/pending");
    expect(init.method).toBe("GET");
    expect(r).toEqual({ requests: [] });
  });

  it("POSTs a create with the family id in the body", async () => {
    mockFetch(true, { id: "lr1", status: "PENDING" });
    await createLinkRequest(
      { kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: "fam1", targetEmail: "a@b.com" },
      getToken
    );
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/v1/link-requests");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ familyGroupId: "fam1", targetEmail: "a@b.com" });
  });

  it("POSTs accept and decline to the id routes", async () => {
    mockFetch(true, { id: "lr1", status: "ACCEPTED", granted: true, resolvedAt: null });
    await acceptLinkRequest("lr1", getToken);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "http://localhost:4000/api/v1/link-requests/lr1/accept"
    );
    mockFetch(true, { id: "lr1", status: "DECLINED", resolvedAt: null });
    await declineLinkRequest("lr1", getToken);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe(
      "http://localhost:4000/api/v1/link-requests/lr1/decline"
    );
  });

  it("throws the API error message on a non-ok create (used to detect CONSENT_REQUIRED)", async () => {
    mockFetch(false, { error: "CONSENT_REQUIRED" }, 409);
    await expect(
      createLinkRequest({ kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: "fam1" }, getToken)
    ).rejects.toThrow("CONSENT_REQUIRED");
  });
});

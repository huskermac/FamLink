import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getConsentRequest, acceptConsentRequest } from "@/lib/api/consent";

const originalEnv = process.env.NEXT_PUBLIC_API_URL;
beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL = originalEnv;
  vi.unstubAllGlobals();
});
function mockFetch(ok: boolean, body: unknown, status = ok ? 200 : 410) {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok, status, json: async () => body, text: async () => JSON.stringify(body)
  });
}

describe("consent client", () => {
  it("GETs the token view (no auth header)", async () => {
    mockFetch(true, { familyName: "The Smiths", targetName: "Jo", status: "PENDING", notice: "n" });
    const r = await getConsentRequest("tok1");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe("http://localhost:4000/api/v1/consent/tok1");
    expect(init).toBeUndefined();
    expect(r.familyName).toBe("The Smiths");
  });

  it("throws when the token get is not ok", async () => {
    mockFetch(false, { error: "This request has expired" }, 410);
    await expect(getConsentRequest("bad")).rejects.toThrow();
  });

  it("POSTs accept and returns the granted body", async () => {
    mockFetch(true, { granted: true, status: "ACCEPTED" });
    const r = await acceptConsentRequest("tok1");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/v1/consent/tok1/accept");
    expect(init.method).toBe("POST");
    expect(r).toEqual({ granted: true, status: "ACCEPTED" });
  });

  it("returns the 409 body without throwing (already resolved)", async () => {
    mockFetch(false, { granted: false, status: "EXPIRED" }, 409);
    const r = await acceptConsentRequest("tok1");
    expect(r).toEqual({ granted: false, status: "EXPIRED" });
  });
});

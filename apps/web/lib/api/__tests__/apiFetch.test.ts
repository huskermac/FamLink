import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch } from "@/lib/api";

const getToken = vi.fn().mockResolvedValue("tok");
const originalEnv = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL = originalEnv;
  vi.unstubAllGlobals();
});

function mockFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    text: async () => text
  });
}

describe("apiFetch", () => {
  it("throws when NEXT_PUBLIC_API_URL is not set", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    await expect(apiFetch("/api/v1/test", { getToken })).rejects.toThrow("NEXT_PUBLIC_API_URL is not set");
  });

  it("calls fetch with the full URL and Authorization header", async () => {
    mockFetch(200, { ok: true });
    await apiFetch("/api/v1/test", { getToken });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect(url).toBe("http://localhost:4000/api/v1/test");
    expect(init.headers.get("Authorization")).toBe("Bearer tok");
    expect(init.headers.get("Content-Type")).toBe("application/json");
  });

  it("does not set Authorization when getToken returns null", async () => {
    mockFetch(200, { ok: true });
    const nullToken = vi.fn().mockResolvedValue(null);
    await apiFetch("/api/v1/test", { getToken: nullToken });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect(init.headers.get("Authorization")).toBeNull();
  });

  it("returns parsed JSON body on success", async () => {
    mockFetch(200, { data: "value" });
    const result = await apiFetch<{ data: string }>("/api/v1/test", { getToken });
    expect(result).toEqual({ data: "value" });
  });

  it("returns undefined when body is empty", async () => {
    mockFetch(200, "");
    const result = await apiFetch("/api/v1/test", { getToken });
    expect(result).toBeUndefined();
  });

  it("throws an API error with the error message from response body", async () => {
    mockFetch(400, { error: "Bad request" }, false);
    await expect(apiFetch("/api/v1/test", { getToken })).rejects.toThrow("API 400: Bad request");
  });

  it("throws an API error using statusText when body has no error field", async () => {
    mockFetch(500, "", false);
    await expect(apiFetch("/api/v1/test", { getToken })).rejects.toThrow("API 500:");
  });

  it("strips trailing slash from base URL", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000/";
    mockFetch(200, {});
    await apiFetch("/api/v1/test", { getToken });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe("http://localhost:4000/api/v1/test");
  });

  it("sets cache: no-store by default", async () => {
    mockFetch(200, {});
    await apiFetch("/api/v1/test", { getToken });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.cache).toBe("no-store");
  });

  it("respects an explicit cache option", async () => {
    mockFetch(200, {});
    await apiFetch("/api/v1/test", { getToken, cache: "force-cache" });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.cache).toBe("force-cache");
  });
});

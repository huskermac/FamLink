import { renderHook } from "@testing-library/react-native";
import { useApiFetch } from "../../lib/api";

jest.mock("@clerk/clerk-expo", () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue("test-token") }),
}));

describe("useApiFetch", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: "ok" }),
    });
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:3001";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("calls the API with Authorization header", async () => {
    const { result } = renderHook(() => useApiFetch());
    await result.current("/test");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
  });

  it("throws on non-ok response", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: "Forbidden" }),
    });
    const { result } = renderHook(() => useApiFetch());
    await expect(result.current("/test")).rejects.toThrow("API 403: Forbidden");
  });

  it("prepends base URL to path", async () => {
    const { result } = renderHook(() => useApiFetch());
    await result.current("/api/v1/persons/me");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/persons/me",
      expect.anything()
    );
  });
});

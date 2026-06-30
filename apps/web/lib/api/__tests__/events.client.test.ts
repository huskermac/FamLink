import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "@/lib/api";
import { previewParticipation, acceptParticipation, isForeignEventDTO } from "@/lib/api/events";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
const apiFetch = vi.mocked(api.apiFetch);
const getToken = vi.fn().mockResolvedValue("t");

beforeEach(() => apiFetch.mockReset());

describe("events client — participation", () => {
  it("previewParticipation calls the relative preview path with auth (getToken)", async () => {
    apiFetch.mockResolvedValue({ state: "PENDING", eventId: "e1" });
    await previewParticipation("tok123", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/participation/preview?token=tok123",
      expect.objectContaining({ method: "GET", getToken })
    );
  });

  it("acceptParticipation posts the token to the event's accept route", async () => {
    apiFetch.mockResolvedValue({ accepted: true });
    await acceptParticipation("e1", "tok123", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/participation/accept",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "tok123" }), getToken })
    );
  });

  it("isForeignEventDTO distinguishes the flat foreign shape from the member shape", () => {
    expect(isForeignEventDTO({ id: "e", title: "t", participants: [], tasks: [] } as never)).toBe(true);
    expect(isForeignEventDTO({ event: { id: "e" } } as never)).toBe(false);
  });
});

import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { errorHandler } from "../../middleware/errorHandler";

function mockRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn()
  } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

describe("errorHandler", () => {
  it("uses err.status when present and hides details outside development", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    const err = Object.assign(new Error("boom"), { status: 418 });

    errorHandler(err, {} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(418);
    // NODE_ENV is "test" here, so the prod branch applies: no message leakage
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    vi.restoreAllMocks();
  });

  it("defaults to 500 for non-Error values", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();

    errorHandler("something broke", {} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    vi.restoreAllMocks();
  });
});

import { describe, it, expect } from "vitest";
import { RECIPROCAL_TYPES } from "../relationship-helpers";

describe("RECIPROCAL_TYPES", () => {
  it("GUARDIAN ↔ WARD", () => {
    expect(RECIPROCAL_TYPES["GUARDIAN"]).toBe("WARD");
    expect(RECIPROCAL_TYPES["WARD"]).toBe("GUARDIAN");
  });

  it("FRIEND is symmetric", () => {
    expect(RECIPROCAL_TYPES["FRIEND"]).toBe("FRIEND");
  });

  it("removed types are absent", () => {
    expect(RECIPROCAL_TYPES["EX_SPOUSE"]).toBeUndefined();
    expect(RECIPROCAL_TYPES["FAMILY_FRIEND"]).toBeUndefined();
    expect(RECIPROCAL_TYPES["STEP_PARENT"]).toBeUndefined();
    expect(RECIPROCAL_TYPES["HALF_SIBLING"]).toBeUndefined();
    expect(RECIPROCAL_TYPES["ADOPTIVE_PARENT"]).toBeUndefined();
  });
});

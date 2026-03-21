import jwt from "jsonwebtoken";
import {
  generateGuestToken,
  verifyGuestToken
} from "../../lib/guestToken";
import { env } from "../../lib/env";

describe("guestToken", () => {
  it("round-trips a valid payload", () => {
    const payload = {
      personId: "person_1",
      scope: "RSVP" as const,
      resourceId: "event_1",
      resourceType: "EVENT" as const
    };
    const token = generateGuestToken(payload, "1h");
    expect(verifyGuestToken(token)).toEqual(payload);
  });

  it("rejects an expired token", async () => {
    const token = generateGuestToken(
      {
        personId: "p",
        scope: "VIEW",
        resourceId: "e",
        resourceType: "EVENT"
      },
      "1ms"
    );
    await new Promise((r) => setTimeout(r, 25));
    expect(() => verifyGuestToken(token)).toThrow(/expired/i);
  });

  it("rejects a token signed with a different secret", () => {
    const bad = jwt.sign(
      {
        personId: "p",
        scope: "RSVP",
        resourceId: "e",
        resourceType: "EVENT"
      },
      "wrong_secret_not_matching_env________",
      { algorithm: "HS256", expiresIn: "1h" }
    );
    expect(() => verifyGuestToken(bad)).toThrow();
  });

  it("rejects a tampered token", () => {
    const token = generateGuestToken(
      {
        personId: "p",
        scope: "RSVP",
        resourceId: "e",
        resourceType: "EVENT"
      },
      "1h"
    );
    const tampered = token.slice(0, -4) + "xxxx";
    expect(() => verifyGuestToken(tampered)).toThrow();
  });

  it("rejects payload with invalid shape", () => {
    const bad = jwt.sign(
      { foo: "bar" },
      env.GUEST_TOKEN_SECRET,
      { algorithm: "HS256", expiresIn: "1h" }
    );
    expect(() => verifyGuestToken(bad)).toThrow();
  });
});

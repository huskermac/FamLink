import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { env } from "./env";

export type GuestTokenScope = "RSVP" | "VIEW" | "JOIN";
export type GuestResourceType = "EVENT" | "FAMILY";

export interface GuestTokenPayload {
  personId: string;
  scope: GuestTokenScope;
  resourceId: string;
  resourceType: GuestResourceType;
}

const payloadSchema = z.object({
  personId: z.string().min(1),
  scope: z.enum(["RSVP", "VIEW", "JOIN"]),
  resourceId: z.string().min(1),
  resourceType: z.enum(["EVENT", "FAMILY"])
});

export function generateGuestToken(
  payload: GuestTokenPayload,
  expiresIn: SignOptions["expiresIn"]
): string {
  const opts: SignOptions = { algorithm: "HS256", expiresIn };
  return jwt.sign({ ...payload }, env.GUEST_TOKEN_SECRET, opts);
}

export function verifyGuestToken(token: string): GuestTokenPayload {
  try {
    const decoded = jwt.verify(token, env.GUEST_TOKEN_SECRET, {
      algorithms: ["HS256"]
    });
    if (typeof decoded === "string" || decoded === null || typeof decoded !== "object") {
      throw new Error("Invalid guest token payload shape");
    }
    return payloadSchema.parse(decoded);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(`Invalid guest token payload: ${err.message}`);
    }
    if (err instanceof jwt.TokenExpiredError) {
      throw new Error("Guest token expired");
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new Error(`Invalid guest token: ${err.message}`);
    }
    throw err;
  }
}

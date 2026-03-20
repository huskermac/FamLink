import type { Request, Response } from "express";
import { Router } from "express";
import { Webhook } from "svix";
import { db } from "@famlink/db";
import { env } from "../lib/env";

export const webhooksRouter = Router();

type ClerkUserPayload = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  email_addresses?: Array<{ email_address?: string }>;
};

type ClerkWebhookBody = {
  type: string;
  data: ClerkUserPayload;
};

function parseBody(req: Request): string {
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }
  return typeof req.body === "string" ? req.body : JSON.stringify(req.body);
}

webhooksRouter.post("/clerk", async (req: Request, res: Response) => {
  try {
    const payload = parseBody(req);
    const wh = new Webhook(env.CLERK_WEBHOOK_SECRET);

    const svixId = req.headers["svix-id"];
    const svixTimestamp = req.headers["svix-timestamp"];
    const svixSignature = req.headers["svix-signature"];

    if (
      typeof svixId !== "string" ||
      typeof svixTimestamp !== "string" ||
      typeof svixSignature !== "string"
    ) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    let evt: ClerkWebhookBody;
    try {
      evt = wh.verify(payload, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature
      }) as ClerkWebhookBody;
    } catch {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const { type, data } = evt;

    if (type === "user.created" || type === "user.updated") {
      const clerkUserId = data.id;
      if (!clerkUserId) {
        return res.status(200).json({ received: true });
      }

      const firstName = (data.first_name ?? "").trim() || "User";
      const lastName = (data.last_name ?? "").trim() || "-";
      const profilePhotoUrl = data.image_url ?? null;

      await db.person.upsert({
        where: { userId: clerkUserId },
        create: {
          userId: clerkUserId,
          firstName,
          lastName,
          ageGateLevel: "NONE",
          profilePhotoUrl
        },
        update: {
          firstName,
          lastName,
          profilePhotoUrl
        }
      });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

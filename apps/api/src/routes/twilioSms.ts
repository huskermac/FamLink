import type { Request, Response } from "express";
import { Router } from "express";
import twilio from "twilio";
import { env } from "../lib/env";
import { handleInboundSms } from "../lib/smsInbound";

export const twilioSmsRouter = Router();

/** Computed per-request (not module load) so env-loading order can never bake in a stale URL. */
function webhookUrl(): string {
  return `${env.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/webhooks/twilio/sms`;
}

twilioSmsRouter.post("/", async (req: Request, res: Response) => {
  const signature = req.headers["x-twilio-signature"];
  const params = (req.body ?? {}) as Record<string, string>;

  if (
    typeof signature !== "string" ||
    !twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, webhookUrl(), params)
  ) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  const from = params.From;
  const body = typeof params.Body === "string" ? params.Body : "";
  const messageSid = params.MessageSid ?? "";
  if (!from) {
    return res.status(400).json({ error: "Missing From" });
  }

  try {
    const reply = await handleInboundSms(from, body, messageSid);
    const twiml = new twilio.twiml.MessagingResponse();
    if (reply) {
      twiml.message(reply);
    }
    return res.type("text/xml").status(200).send(twiml.toString());
  } catch (e) {
    console.error(JSON.stringify({ event: "sms_inbound_error", messageSid, error: e instanceof Error ? e.message : String(e) }));
    return res.status(500).json({ error: "Internal error" }); // Twilio retries; handler is idempotent
  }
});

import twilio from "twilio";
import { Resend } from "resend";
import { env } from "./env";

/**
 * Sends family join invitation email and/or SMS. Caller supplies a guest JWT
 * (e.g. `generateGuestToken` with scope JOIN, resourceType FAMILY, expiresIn "7d").
 */
export async function sendFamilyJoinInvitation(params: {
  inviterName: string;
  familyName: string;
  recipientEmail: string | null;
  recipientPhone: string | null;
  recipientFirstName: string;
  guestToken: string;
}): Promise<void> {
  const web = env.WEB_APP_URL.replace(/\/$/, "");
  const joinUrl = `${web}/join?token=${encodeURIComponent(params.guestToken)}`;

  const resend = new Resend(env.RESEND_API_KEY);
  const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const fromEmail = `FamLink <invites@${env.RESEND_FROM_DOMAIN}>`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px;">
  <p style="font-size:18px;font-weight:600;">FamLink</p>
  <p>Hi ${escapeHtml(params.recipientFirstName)},</p>
  <p><strong>${escapeHtml(params.inviterName)}</strong> invited you to join <strong>${escapeHtml(params.familyName)}</strong> on FamLink — a private space for your family calendar, events, and coordination.</p>
  <p style="margin:28px 0;">
    <a href="${joinUrl}" style="display:inline-block;background:#0f6e56;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">Accept invitation</a>
  </p>
  <p style="font-size:13px;color:#555;">If the button does not work, copy this link:<br/><span style="word-break:break-all;">${escapeHtml(joinUrl)}</span></p>
</body></html>`;

  const errors: string[] = [];

  if (params.recipientEmail) {
    try {
      const result = await resend.emails.send({
        from: fromEmail,
        to: params.recipientEmail,
        subject: `${params.inviterName} invited you to join ${params.familyName} on FamLink`,
        html
      });
      if (result.error) {
        errors.push(`email: ${result.error.message}`);
      }
    } catch (e) {
      errors.push(`email: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (params.recipientPhone) {
    try {
      const base = `${params.inviterName} invited you to join ${params.familyName} on FamLink. Accept: ${joinUrl}`;
      const body = base.length > 160 ? base.slice(0, 160) : base;
      await twilioClient.messages.create({
        from: env.TWILIO_PHONE_NUMBER,
        to: params.recipientPhone,
        body
      });
    } catch (e) {
      errors.push(`sms: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

import twilio from "twilio";
import { Resend } from "resend";
import { env } from "./env";

export type InvitationRecipient = {
  personId: string;
  firstName: string;
  email: string | null;
  phone: string | null;
  guestToken: string | null;
  isGuest: boolean;
};

export type EventInvitationPayload = {
  eventId: string;
  event: {
    title: string;
    startAt: string;
    locationName: string | null;
  };
  familyName: string;
  inviterName: string;
  recipients: InvitationRecipient[];
};

const MAX_SMS = 160;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatEventDateTimeUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short"
  });
}

/** Exported for unit tests — SMS body for guests, max 160 chars; truncates title if needed. */
export function buildEventInviteSmsBody(
  recipient: InvitationRecipient,
  payload: EventInvitationPayload
): string {
  const token = recipient.guestToken ?? "";
  const dateStr = formatEventDateTimeUtc(payload.event.startAt);
  const web = env.WEB_APP_URL.replace(/\/$/, "");
  const rsvpUrl = `${web}/rsvp?token=${encodeURIComponent(token)}`;
  const prefix = `${payload.inviterName} invited you to `;
  const suffix = ` on ${dateStr}. RSVP: ${rsvpUrl}`;
  const budget = MAX_SMS - prefix.length - suffix.length;
  let title = payload.event.title;
  if (budget < 1) {
    title = "…";
  } else if (title.length > budget) {
    title = title.slice(0, Math.max(0, budget - 1)) + "…";
  }
  const body = `${prefix}${title}${suffix}`;
  return body.length > MAX_SMS ? body.slice(0, MAX_SMS) : body;
}

function buildEventInviteEmailHtml(recipient: InvitationRecipient, payload: EventInvitationPayload): string {
  const web = env.WEB_APP_URL.replace(/\/$/, "");
  const eventUrl = `${web}/events/${encodeURIComponent(payload.eventId)}`;
  const rsvpUrl = recipient.guestToken
    ? `${web}/rsvp?token=${encodeURIComponent(recipient.guestToken)}`
    : eventUrl;
  const primaryLabel = recipient.guestToken ? "RSVP now" : "View event";
  const primaryHref = recipient.guestToken ? rsvpUrl : eventUrl;

  const loc =
    payload.event.locationName !== null && payload.event.locationName !== ""
      ? `<p><strong>Location:</strong> ${escapeHtml(payload.event.locationName)}</p>`
      : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Invitation</title></head>
<body style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px;">
  <p style="font-size:18px;font-weight:600;">FamLink</p>
  <p>Hi ${escapeHtml(recipient.firstName)},</p>
  <p><strong>${escapeHtml(payload.inviterName)}</strong> invited you to an event in <strong>${escapeHtml(payload.familyName)}</strong>.</p>
  <h2 style="font-size:20px;margin:24px 0 8px;">${escapeHtml(payload.event.title)}</h2>
  <p><strong>When:</strong> ${escapeHtml(formatEventDateTimeUtc(payload.event.startAt))}</p>
  ${loc}
  <p style="margin:28px 0;">
    <a href="${primaryHref}" style="display:inline-block;background:#0f6e56;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">${primaryLabel}</a>
  </p>
  <p style="font-size:13px;color:#555;">If the button does not work, copy this link:<br/><span style="word-break:break-all;">${escapeHtml(primaryHref)}</span></p>
</body></html>`;
}

export class InvitationService {
  private readonly resend: Resend;
  private readonly twilioClient: ReturnType<typeof twilio>;

  constructor() {
    this.resend = new Resend(env.RESEND_API_KEY);
    this.twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  }

  async sendEventInvitations(
    payload: EventInvitationPayload
  ): Promise<{ emailsSent: number; smsSent: number; errors: string[] }> {
    const errors: string[] = [];
    let emailsSent = 0;
    let smsSent = 0;

    const fromEmail = `FamLink <invites@${env.RESEND_FROM_DOMAIN}>`;

    for (const recipient of payload.recipients) {
      if (recipient.email) {
        try {
          const result = await this.resend.emails.send({
            from: fromEmail,
            to: recipient.email,
            subject: `You're invited: ${payload.event.title}`,
            html: buildEventInviteEmailHtml(recipient, payload)
          });
          if (result.error) {
            errors.push(`email ${recipient.personId}: ${result.error.message}`);
          } else {
            emailsSent += 1;
          }
        } catch (e) {
          errors.push(`email ${recipient.personId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (recipient.phone && recipient.isGuest) {
        if (!recipient.guestToken) {
          errors.push(`sms ${recipient.personId}: missing guestToken for guest`);
          continue;
        }
        try {
          const body = buildEventInviteSmsBody(recipient, payload);
          await this.twilioClient.messages.create({
            from: env.TWILIO_PHONE_NUMBER,
            to: recipient.phone,
            body
          });
          smsSent += 1;
        } catch (e) {
          errors.push(`sms ${recipient.personId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    return { emailsSent, smsSent, errors };
  }
}

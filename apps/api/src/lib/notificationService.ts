import admin from "firebase-admin";
import twilio from "twilio";
import { Resend } from "resend";
import { db } from "@famlink/db";
import { RSVPStatus } from "@famlink/shared";
import { env } from "./env";
import { generateBirthdayEvents } from "./birthdayGenerator";

export type NotificationPayload = {
  type:
    | "EVENT_INVITE"
    | "RSVP_RECEIVED"
    | "EVENT_REMINDER"
    | "BIRTHDAY_REMINDER"
    | "FAMILY_JOIN"
    | "WEEKLY_DIGEST";
  recipientPersonId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  emailHtml?: string;
};

export type DeliveryResult = {
  channel: "EMAIL" | "SMS" | "PUSH";
  success: boolean;
  error?: string;
};

export const MAX_NOTIFICATION_SMS = 160;

function normalizeFirebasePrivateKey(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: normalizeFirebasePrivateKey(env.FIREBASE_PRIVATE_KEY)
    })
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function truncateNotificationSmsBody(body: string): string {
  const t = body.trim();
  return t.length <= MAX_NOTIFICATION_SMS ? t : t.slice(0, MAX_NOTIFICATION_SMS);
}

export class NotificationService {
  private readonly resend: Resend;
  private readonly twilioClient: ReturnType<typeof twilio>;

  constructor() {
    this.resend = new Resend(env.RESEND_API_KEY);
    this.twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  }

  private isChannelEnabled(
    person: { userId: string | null; fcmToken: string | null },
    channel: "EMAIL" | "SMS" | "PUSH",
    notifType: string,
    prefs: Array<{ channel: string; notifType: string; enabled: boolean }>
  ): boolean {
    const pref = prefs.find((p) => p.channel === channel && p.notifType === notifType);
    if (pref) {
      return pref.enabled;
    }
    if (channel === "EMAIL") {
      return true;
    }
    if (channel === "SMS") {
      return person.userId === null;
    }
    if (channel === "PUSH") {
      return Boolean(person.fcmToken);
    }
    return false;
  }

  private async sendEmail(to: string, title: string, body: string, html?: string): Promise<boolean> {
    const from = `FamLink <notifications@${env.RESEND_FROM_DOMAIN}>`;
    const result = await this.resend.emails.send({
      from,
      to,
      subject: title,
      html: html ?? `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap;">${escapeHtml(body)}</pre>`
    });
    if (result.error) {
      return false;
    }
    return true;
  }

  private async sendSms(to: string, body: string): Promise<boolean> {
    const text = truncateNotificationSmsBody(body);
    await this.twilioClient.messages.create({
      from: env.TWILIO_PHONE_NUMBER,
      to,
      body: text
    });
    return true;
  }

  private async sendPush(
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<boolean> {
    const dataPayload: Record<string, string> = {};
    if (data) {
      for (const [k, v] of Object.entries(data)) {
        dataPayload[k] = v;
      }
    }
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: dataPayload
    });
    return true;
  }

  async send(payload: NotificationPayload): Promise<DeliveryResult[]> {
    const person = await db.person.findUnique({ where: { id: payload.recipientPersonId } });
    if (!person) {
      throw new Error(`Person not found: ${payload.recipientPersonId}`);
    }

    const prefs = await db.notificationPreference.findMany({
      where: { personId: person.id }
    });

    const order: Array<"EMAIL" | "SMS" | "PUSH"> = ["EMAIL", "SMS", "PUSH"];
    const results: DeliveryResult[] = [];

    for (const channel of order) {
      if (!this.isChannelEnabled(person, channel, payload.type, prefs)) {
        continue;
      }

      try {
        if (channel === "EMAIL") {
          const to = person.email;
          if (!to) {
            results.push({ channel: "EMAIL", success: false, error: "missing email" });
            continue;
          }
          const ok = await this.sendEmail(to, payload.title, payload.body, payload.emailHtml);
          results.push({
            channel: "EMAIL",
            success: ok,
            ...(ok ? {} : { error: "email send failed" })
          });
        } else if (channel === "SMS") {
          const to = person.phone;
          if (!to) {
            results.push({ channel: "SMS", success: false, error: "missing phone" });
            continue;
          }
          const ok = await this.sendSms(to, payload.body);
          results.push({ channel: "SMS", success: ok });
        } else {
          const token = person.fcmToken;
          if (!token) {
            results.push({ channel: "PUSH", success: false, error: "missing fcm token" });
            continue;
          }
          const ok = await this.sendPush(token, payload.title, payload.body, payload.data);
          results.push({ channel: "PUSH", success: ok });
        }
      } catch (e) {
        results.push({
          channel,
          success: false,
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }

    return results;
  }

  async scheduleEventReminder(eventId: string, minutesBefore: number): Promise<void> {
    const event = await db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new Error(`Event not found: ${eventId}`);
    }

    const yes = await db.rSVP.findMany({
      where: { eventId, status: RSVPStatus.YES },
      select: { personId: true }
    });

    const title = `Reminder: ${event.title}`;
    const body = `Starts in ${minutesBefore} minute(s). ${event.title} at ${event.startAt.toISOString()}.`;

    for (const r of yes) {
      await this.send({
        type: "EVENT_REMINDER",
        recipientPersonId: r.personId,
        title,
        body,
        data: {
          eventId: event.id,
          minutesBefore: String(minutesBefore)
        }
      });
    }
  }

  async sendWeeklyDigest(familyGroupId: string): Promise<void> {
    const family = await db.familyGroup.findUnique({ where: { id: familyGroupId } });
    if (!family) {
      throw new Error(`Family not found: ${familyGroupId}`);
    }

    const members = await db.familyMember.findMany({
      where: { familyGroupId },
      include: { person: true }
    });

    const now = new Date();
    const windowEnd = new Date(now.getTime() + 7 * 86_400_000);

    const personsPayload = members.map((m) => ({
      id: m.person.id,
      firstName: m.person.firstName,
      lastName: m.person.lastName,
      dateOfBirth: m.person.dateOfBirth ? m.person.dateOfBirth.toISOString().slice(0, 10) : null
    }));

    const dbEvents = await db.event.findMany({
      where: {
        familyGroupId,
        startAt: { gte: now, lte: windowEnd }
      },
      orderBy: { startAt: "asc" }
    });

    const minY = now.getUTCFullYear();
    const maxY = windowEnd.getUTCFullYear();
    const synthetic: ReturnType<typeof generateBirthdayEvents> = [];
    for (let y = minY; y <= maxY; y++) {
      synthetic.push(...generateBirthdayEvents(personsPayload, y, familyGroupId));
    }
    const birthdaysInWindow = synthetic.filter((e) => {
      const t = new Date(e.startAt).getTime();
      return t >= now.getTime() && t <= windowEnd.getTime();
    });

    const eventLines = dbEvents.map((e) => `• ${e.title} — ${e.startAt.toISOString()}`);
    const bdayLines = birthdaysInWindow.map((b) => `• ${b.title} — ${b.startAt.slice(0, 10)}`);

    const plainBody = [
      `Upcoming in ${family.name} (next 7 days)`,
      "",
      "Events:",
      eventLines.length > 0 ? eventLines.join("\n") : "• None",
      "",
      "Birthdays:",
      bdayLines.length > 0 ? bdayLines.join("\n") : "• None"
    ].join("\n");

    const emailHtml = buildWeeklyDigestHtml(family.name, dbEvents, birthdaysInWindow);

    for (const m of members) {
      await this.send({
        type: "WEEKLY_DIGEST",
        recipientPersonId: m.personId,
        title: `Weekly digest — ${family.name}`,
        body: plainBody,
        emailHtml
      });
    }
  }
}

function buildWeeklyDigestHtml(
  familyName: string,
  dbEvents: Array<{ title: string; startAt: Date }>,
  birthdaysInWindow: Array<{ title: string; startAt: string }>
): string {
  const evRows =
    dbEvents.length === 0
      ? "<li>None</li>"
      : dbEvents
          .map(
            (e) =>
              `<li><strong>${escapeHtml(e.title)}</strong> — ${escapeHtml(e.startAt.toISOString())}</li>`
          )
          .join("");
  const bdRows =
    birthdaysInWindow.length === 0
      ? "<li>None</li>"
      : birthdaysInWindow
          .map((b) => `<li><strong>${escapeHtml(b.title)}</strong> — ${escapeHtml(b.startAt.slice(0, 10))}</li>`)
          .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Weekly digest</title></head>
<body style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px;">
  <p style="font-size:18px;font-weight:600;">FamLink</p>
  <h1 style="font-size:20px;">${escapeHtml(familyName)} — next 7 days</h1>
  <h2 style="font-size:16px;">Events</h2>
  <ul>${evRows}</ul>
  <h2 style="font-size:16px;">Birthdays</h2>
  <ul>${bdRows}</ul>
</body></html>`;
}

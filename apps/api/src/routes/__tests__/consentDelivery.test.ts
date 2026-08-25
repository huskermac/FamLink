import { db } from "@famlink/db";
import { buildConsentMessage, deliverConsentLink } from "../../lib/consentDelivery";
import { GUEST_SMS_FOOTER, MAX_GUEST_INVITE_SMS } from "../../lib/notificationService";
import { generateConsentToken } from "../../lib/linkRequest";
import { seedTestFamily } from "../../__tests__/helpers/db";

const mockIsPhoneSuppressed = vi.fn();
vi.mock("../../lib/smsConsent", () => ({
  isPhoneSuppressed: (...args: unknown[]) => mockIsPhoneSuppressed(...args)
}));

const mockEmailSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return {
      emails: {
        send: (...args: unknown[]) => mockEmailSend(...args)
      }
    };
  })
}));

const mockSmsCreate = vi.fn();
vi.mock("twilio", () => {
  const fn = vi.fn().mockImplementation(() => ({
    messages: {
      create: (...args: unknown[]) => mockSmsCreate(...args)
    }
  }));
  return { __esModule: true, default: fn };
});

describe("consentDelivery", () => {
  beforeEach(() => {
    mockIsPhoneSuppressed.mockReset();
    mockIsPhoneSuppressed.mockResolvedValue(false);
    mockEmailSend.mockReset();
    mockEmailSend.mockResolvedValue({ data: { id: "em_1" }, error: null, headers: null });
    mockSmsCreate.mockReset();
    mockSmsCreate.mockResolvedValue({ sid: "SM1" });
  });

  describe("buildConsentMessage", () => {
    it("names the family only — no roster, no other member names", () => {
      const m = buildConsentMessage({ familyName: "The Smiths", consentUrl: "http://x/consent/tok123" });
      expect(m.subject).toBe("Join The Smiths on FamLink");
      expect(m.body).toContain("The Smiths");
      expect(m.body).toContain("http://x/consent/tok123");
      expect(m.smsBody).toContain("The Smiths");
    });

    it("budgets the SMS with the compliance footer, never exceeding 320 chars", () => {
      const m = buildConsentMessage({
        familyName: "A".repeat(250),
        consentUrl: "http://x/consent/" + "t".repeat(64)
      });
      expect(m.smsBody.length).toBeLessThanOrEqual(MAX_GUEST_INVITE_SMS);
      expect(m.smsBody.endsWith(GUEST_SMS_FOOTER)).toBe(true);
    });
  });

  describe("deliverConsentLink", () => {
    async function seedTokenRequest(personOverrides?: Partial<{
      email: string | null;
      phone: string | null;
      emailNormalized: string | null;
      phoneNormalized: string | null;
    }>) {
      const adminAuthId = `admin_${Math.random().toString(36).slice(2)}`;
      const admin = await db.person.create({
        data: { firstName: "Admin", lastName: "One", ageGateLevel: "ADULT", userId: adminAuthId }
      });
      const { familyGroup } = await seedTestFamily(admin.id);
      const target = await db.person.create({
        data: {
          firstName: "Target",
          lastName: "Person",
          ageGateLevel: "ADULT",
          userId: null,
          email: personOverrides?.email ?? null,
          phone: personOverrides?.phone ?? null,
          emailNormalized: personOverrides?.emailNormalized ?? null,
          phoneNormalized: personOverrides?.phoneNormalized ?? null
        }
      });
      const request = await db.linkRequest.create({
        data: {
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetPersonId: target.id,
          requestedByPersonId: admin.id,
          status: "PENDING",
          token: generateConsentToken(),
          attestedAdult: true,
          expiresAt: new Date(Date.now() + 30 * 86_400_000)
        }
      });
      return { request, target, familyGroup };
    }

    it("uses the normalized contact when the raw contact is null (the CIF case)", async () => {
      const { request, target } = await seedTokenRequest({ phone: null, phoneNormalized: "+15551234567" });

      await deliverConsentLink({ request, personId: target.id });

      const row = await db.linkRequest.findUnique({ where: { id: request.id } });
      expect(row?.tokenChannel).toBe("SMS");
      expect(row?.deliveredContact).toBe("+15551234567");
      expect(mockSmsCreate).toHaveBeenCalledTimes(1);
      expect(mockSmsCreate.mock.calls[0][0].to).toBe("+15551234567");
    });

    it("uses ONE channel with both contacts present — sent on one, not both", async () => {
      const { request, target } = await seedTokenRequest({
        phone: "+15551234567",
        email: "target@example.com"
      });

      await deliverConsentLink({ request, personId: target.id });

      const row = await db.linkRequest.findUnique({ where: { id: request.id } });
      expect(row?.tokenChannel).toBe("SMS");
      expect(row?.deliveredContact).toBe("+15551234567");
      expect(mockSmsCreate).toHaveBeenCalledTimes(1);
      expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it("falls back to email when the SMS number is suppressed", async () => {
      mockIsPhoneSuppressed.mockResolvedValue(true);
      const { request, target } = await seedTokenRequest({
        phone: "+15551234567",
        email: "target@example.com"
      });

      await deliverConsentLink({ request, personId: target.id });

      const row = await db.linkRequest.findUnique({ where: { id: request.id } });
      expect(row?.tokenChannel).toBe("EMAIL");
      expect(row?.deliveredContact).toBe("target@example.com");
      expect(mockSmsCreate).not.toHaveBeenCalled();
      expect(mockEmailSend).toHaveBeenCalledTimes(1);
    });

    it("is a no-op with no deliverable channel (no phone, no email)", async () => {
      const { request } = await seedTokenRequest({});
      const target = await db.person.create({
        data: { firstName: "NoContact", lastName: "Person", ageGateLevel: "ADULT", userId: null }
      });

      await deliverConsentLink({ request, personId: target.id });

      const row = await db.linkRequest.findUnique({ where: { id: request.id } });
      expect(row?.tokenChannel).toBeNull();
      expect(row?.deliveredContact).toBeNull();
      expect(mockSmsCreate).not.toHaveBeenCalled();
      expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it("logs the request id, never the token", async () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const { request, target } = await seedTokenRequest({ email: "target@example.com" });

      await deliverConsentLink({ request, personId: target.id });

      const logged = infoSpy.mock.calls.map((c) => String(c[0]));
      expect(logged.some((l) => l.includes(request.id))).toBe(true);
      expect(logged.some((l) => l.includes(request.token!))).toBe(false);
      infoSpy.mockRestore();
    });
  });
});

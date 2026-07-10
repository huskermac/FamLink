import {
  NotificationService,
  truncateNotificationSmsBody,
  buildGuestInvitationMessage,
  GUEST_SMS_FOOTER,
  MAX_GUEST_INVITE_SMS
} from "../../lib/notificationService";

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

const mockPersonFind = vi.fn();
const mockPrefFind = vi.fn();
const mockEventFindUnique = vi.fn();
const mockEventFindMany = vi.fn();
const mockRsvpFindMany = vi.fn();
const mockFamilyFindUnique = vi.fn();
const mockFamilyMemberFindMany = vi.fn();

vi.mock("@famlink/db", () => ({
  db: {
    person: {
      findUnique: (...args: unknown[]) => mockPersonFind(...args)
    },
    notificationPreference: {
      findMany: (...args: unknown[]) => mockPrefFind(...args)
    },
    event: {
      findUnique: (...args: unknown[]) => mockEventFindUnique(...args),
      findMany: (...args: unknown[]) => mockEventFindMany(...args)
    },
    rSVP: {
      findMany: (...args: unknown[]) => mockRsvpFindMany(...args)
    },
    familyGroup: {
      findUnique: (...args: unknown[]) => mockFamilyFindUnique(...args)
    },
    familyMember: {
      findMany: (...args: unknown[]) => mockFamilyMemberFindMany(...args)
    }
  }
}));

describe("notificationService", () => {
  beforeEach(() => {
    mockEmailSend.mockReset();
    mockSmsCreate.mockReset();
    mockPersonFind.mockReset();
    mockPrefFind.mockReset();
    mockEventFindUnique.mockReset();
    mockEventFindMany.mockReset();
    mockRsvpFindMany.mockReset();
    mockFamilyFindUnique.mockReset();
    mockFamilyMemberFindMany.mockReset();
    mockIsPhoneSuppressed.mockReset();
    mockIsPhoneSuppressed.mockResolvedValue(false);
  });

  it("truncateNotificationSmsBody caps at 160 characters", () => {
    const long = "x".repeat(200);
    expect(truncateNotificationSmsBody(long).length).toBe(160);
    expect(truncateNotificationSmsBody("short")).toBe("short");
  });

  it("send delivers email only when user has account (SMS default off)", async () => {
    mockPersonFind.mockResolvedValue({
      id: "p1",
      userId: "u_clerk",
      email: "a@example.com",
      phone: "+15550001111",
      fcmToken: null,
      firstName: "A",
      lastName: "B",
      preferredName: null,
      dateOfBirth: null,
      ageGateLevel: "ADULT",
      guardianPersonId: null,
      profilePhotoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    mockPrefFind.mockResolvedValue([]);
    mockEmailSend.mockResolvedValue({ data: { id: "em1" }, error: null, headers: null });

    const svc = new NotificationService();
    const results = await svc.send({
      type: "RSVP_RECEIVED",
      recipientPersonId: "p1",
      title: "RSVP",
      body: "Someone responded"
    });

    expect(results.filter((r) => r.channel === "EMAIL")).toEqual([{ channel: "EMAIL", success: true }]);
    expect(results.some((r) => r.channel === "SMS")).toBe(false);
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    expect(mockSmsCreate).not.toHaveBeenCalled();
  });

  it("send uses SMS default for userId-null (Reluctant Member) when phone present", async () => {
    mockPersonFind.mockResolvedValue({
      id: "p2",
      userId: null,
      email: null,
      phone: "+15550002222",
      fcmToken: null,
      firstName: "G",
      lastName: "uest",
      preferredName: null,
      dateOfBirth: null,
      ageGateLevel: "ADULT",
      guardianPersonId: null,
      profilePhotoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    mockPrefFind.mockResolvedValue([]);
    mockSmsCreate.mockResolvedValue({ sid: "SM1" });

    const svc = new NotificationService();
    const results = await svc.send({
      type: "EVENT_REMINDER",
      recipientPersonId: "p2",
      title: "Reminder",
      body: "x".repeat(300)
    });

    expect(results.some((r) => r.channel === "SMS" && r.success)).toBe(true);
    const body = mockSmsCreate.mock.calls[0][0].body as string;
    expect(body.length).toBeLessThanOrEqual(160);
  });

  it("scheduleEventReminder notifies only YES rsvps", async () => {
    mockEventFindUnique.mockResolvedValue({
      id: "ev1",
      familyGroupId: "fg",
      title: "Party",
      startAt: new Date(Date.UTC(2030, 0, 1, 20, 0, 0)),
      endAt: null,
      description: null,
      createdByPersonId: "p0",
      locationName: null,
      locationAddress: null,
      locationMapUrl: null,
      visibility: "FAMILY",
      isRecurring: false,
      recurrenceRule: null,
      isBirthdayEvent: false,
      birthdayPersonId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    mockRsvpFindMany.mockResolvedValue([{ personId: "yes1" }, { personId: "yes2" }]);
    mockPersonFind.mockImplementation(async (args: { where: { id: string } }) => {
      const id = args.where.id;
      return {
        id,
        userId: "u1",
        email: `${id}@y.com`,
        phone: null,
        fcmToken: null,
        firstName: "Y",
        lastName: id,
        preferredName: null,
        dateOfBirth: null,
        ageGateLevel: "ADULT",
        guardianPersonId: null,
        profilePhotoUrl: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    });
    mockPrefFind.mockResolvedValue([]);
    mockEmailSend.mockResolvedValue({ data: { id: "e" }, error: null, headers: null });

    const svc = new NotificationService();
    await svc.scheduleEventReminder("ev1", 30);

    expect(mockRsvpFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ eventId: "ev1", status: "YES" })
      })
    );
    expect(mockPersonFind).toHaveBeenCalled();
    expect(mockEmailSend.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("sendGuestInvitation skips SMS (no Twilio call) when the number is suppressed", async () => {
    mockIsPhoneSuppressed.mockResolvedValue(true);
    const svc = new NotificationService();
    await svc.sendGuestInvitation({
      invitationId: "inv1",
      email: null,
      phone: "+15550001111",
      message: { subject: "s", body: "b", smsBody: "b" }
    });
    expect(mockSmsCreate).not.toHaveBeenCalled();
  });

  it("guest SMS body ends with the compliance footer and contains the RSVP link", () => {
    const m = buildGuestInvitationMessage({
      eventTitle: "BBQ",
      startAt: new Date("2026-08-01T18:00:00Z"),
      rsvpUrl: "https://app.example.com/rsvp/tok123"
    });
    expect(m.smsBody.endsWith(GUEST_SMS_FOOTER)).toBe(true);
    expect(m.smsBody).toContain("https://app.example.com/rsvp/tok123");
  });

  it("long titles truncate but the link and footer survive, within the 320-char budget", () => {
    const m = buildGuestInvitationMessage({
      eventTitle: "x".repeat(500),
      startAt: new Date("2026-08-01T18:00:00Z"),
      rsvpUrl: "https://app.example.com/rsvp/tok123"
    });
    expect(m.smsBody.length).toBeLessThanOrEqual(MAX_GUEST_INVITE_SMS);
    expect(m.smsBody).toContain("https://app.example.com/rsvp/tok123");
    expect(m.smsBody.endsWith(GUEST_SMS_FOOTER)).toBe(true);
    expect(m.smsBody).toContain("…");
  });

  it("sendGuestInvitation sends the un-truncated smsBody to Twilio", async () => {
    const m = buildGuestInvitationMessage({
      eventTitle: "Reunion",
      startAt: new Date("2026-08-01T18:00:00Z"),
      rsvpUrl: "https://app.example.com/rsvp/tok123"
    });
    const svc = new NotificationService();
    await svc.sendGuestInvitation({ invitationId: "i1", email: null, phone: "+15550002222", message: m });
    expect(mockSmsCreate).toHaveBeenCalledWith(expect.objectContaining({ body: m.smsBody }));
  });

  it("send() SMS channel reports success:false when suppressed", async () => {
    mockPersonFind.mockResolvedValue({ id: "p1", userId: null, email: null, phone: "+15550001111", fcmToken: null });
    mockPrefFind.mockResolvedValue([]);
    mockIsPhoneSuppressed.mockResolvedValue(true);
    const svc = new NotificationService();
    const results = await svc.send({ type: "EVENT_INVITE", recipientPersonId: "p1", title: "t", body: "b" });
    const sms = results.find((r) => r.channel === "SMS");
    expect(sms?.success).toBe(false);
    expect(mockSmsCreate).not.toHaveBeenCalled();
  });
});

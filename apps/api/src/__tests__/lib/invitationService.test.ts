import type { EventInvitationPayload, InvitationRecipient } from "../../lib/invitationService";
import { buildEventInviteSmsBody, InvitationService } from "../../lib/invitationService";

const mockEmailSend = jest.fn();
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: (...args: unknown[]) => mockEmailSend(...args)
    }
  }))
}));

const mockSmsCreate = jest.fn();
jest.mock("twilio", () => {
  const fn = jest.fn().mockImplementation(() => ({
    messages: {
      create: (...args: unknown[]) => mockSmsCreate(...args)
    }
  }));
  return { __esModule: true, default: fn };
});

describe("invitationService", () => {
  beforeEach(() => {
    mockEmailSend.mockReset();
    mockSmsCreate.mockReset();
  });

  it("buildEventInviteSmsBody is at most 160 characters", () => {
    const payload: EventInvitationPayload = {
      eventId: "e1",
      event: {
        title: "A".repeat(200),
        startAt: new Date(Date.UTC(2030, 5, 15, 18, 0, 0)).toISOString(),
        locationName: null
      },
      familyName: "Fam",
      inviterName: "Pat",
      recipients: []
    };
    const recipient: InvitationRecipient = {
      personId: "p1",
      firstName: "Sam",
      email: null,
      phone: "+1",
      guestToken: "tok",
      isGuest: true
    };
    const body = buildEventInviteSmsBody(recipient, payload);
    expect(body.length).toBeLessThanOrEqual(160);
  });

  it("sendEventInvitations continues after one email failure (partial success)", async () => {
    mockEmailSend
      .mockResolvedValueOnce({
        data: null,
        error: { message: "bounce", statusCode: 422, name: "validation_error" as const },
        headers: null
      })
      .mockResolvedValueOnce({
        data: { id: "em_1" },
        error: null,
        headers: null
      });

    const svc = new InvitationService();
    const payload: EventInvitationPayload = {
      eventId: "evt",
      event: {
        title: "Party",
        startAt: new Date().toISOString(),
        locationName: null
      },
      familyName: "Smiths",
      inviterName: "Alex",
      recipients: [
        {
          personId: "a",
          firstName: "Bad",
          email: "bad@example.com",
          phone: null,
          guestToken: null,
          isGuest: false
        },
        {
          personId: "b",
          firstName: "Good",
          email: "good@example.com",
          phone: null,
          guestToken: null,
          isGuest: false
        }
      ]
    };

    const result = await svc.sendEventInvitations(payload);
    expect(result.emailsSent).toBe(1);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(mockEmailSend).toHaveBeenCalledTimes(2);
  });

  it("sendEventInvitations sends SMS only for isGuest with phone and guestToken", async () => {
    mockEmailSend.mockResolvedValue({ data: { id: "x" }, error: null, headers: null });
    mockSmsCreate.mockResolvedValue({ sid: "SM1" });

    const svc = new InvitationService();
    await svc.sendEventInvitations({
      eventId: "evt",
      event: {
        title: "Hi",
        startAt: new Date().toISOString(),
        locationName: null
      },
      familyName: "F",
      inviterName: "I",
      recipients: [
        {
          personId: "g",
          firstName: "Guest",
          email: null,
          phone: "+15550001111",
          guestToken: "jwt",
          isGuest: true
        }
      ]
    });

    expect(mockSmsCreate).toHaveBeenCalledTimes(1);
    const body = mockSmsCreate.mock.calls[0][0].body as string;
    expect(body.length).toBeLessThanOrEqual(160);
    expect(body).toContain("/rsvp?token=");
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue("t") }) }));

const mockCreatePerson = vi.fn();
const mockAddMember = vi.fn();
vi.mock("@/lib/api/family", () => ({
  createPerson: (...a: unknown[]) => mockCreatePerson(...a),
  addFamilyMember: (...a: unknown[]) => mockAddMember(...a)
}));
const mockCreateLR = vi.fn();
vi.mock("@/lib/api/linkRequests", () => ({ createLinkRequest: (...a: unknown[]) => mockCreateLR(...a) }));

const invalidate = vi.fn();
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: invalidate }) }));

import { AddMemberForm } from "@/components/family/AddMemberForm";

beforeEach(() => {
  mockCreatePerson.mockReset();
  mockCreateLR.mockReset();
  invalidate.mockClear();
});

// Vitest 4.1.4 rejection-tracking race: resetting a vi.mock-backed fn in beforeEach
// when a later test rejects it can surface as an unhandled-rejection error rather
// than an assertion failure. Reset mockAddMember after each test instead.
afterEach(() => {
  mockAddMember.mockReset();
});

async function fillName() {
  await userEvent.type(screen.getByLabelText(/first name/i), "Jo");
  await userEvent.type(screen.getByLabelText(/last name/i), "Doe");
}

describe("AddMemberForm", () => {
  it("no contact: creates a person, adds a member, and invalidates the family query", async () => {
    mockCreatePerson.mockResolvedValue({ id: "p1" });
    mockAddMember.mockResolvedValue({ id: "m1", personId: "p1" });
    render(<AddMemberForm familyId="fam1" households={[]} />);
    await fillName();
    await userEvent.click(screen.getByRole("button", { name: /add member/i }));
    expect(mockCreatePerson).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Jo", lastName: "Doe", familyGroupId: "fam1" }),
      expect.anything()
    );
    expect(mockAddMember).toHaveBeenCalledWith("fam1", "p1", expect.anything());
    expect(mockCreateLR).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["family", "fam1"] });
  });

  it("with contact: creates a link request, never touches the direct-add path, and sends no name", async () => {
    mockCreateLR.mockResolvedValue({ id: "lr1", status: "PENDING" });
    render(<AddMemberForm familyId="fam1" households={[]} />);
    await fillName();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.click(screen.getByLabelText(/adult/i));
    await userEvent.click(screen.getByRole("button", { name: /add member/i }));
    expect(mockCreatePerson).not.toHaveBeenCalled();
    expect(mockAddMember).not.toHaveBeenCalled();
    const arg = mockCreateLR.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({ familyGroupId: "fam1", direction: "PULL", targetEmail: "a@b.com", attestedAdult: true });
    expect(arg.firstName).toBeUndefined();
    expect(arg.lastName).toBeUndefined();
    expect(await screen.findByText(/pending consent/i)).toBeInTheDocument();
  });

  it("no contact 409: retries silently as a link request by personId", async () => {
    mockCreatePerson.mockResolvedValue({ id: "p1" });
    mockAddMember.mockRejectedValue(new Error("API 409: CONSENT_REQUIRED"));
    mockCreateLR.mockResolvedValue({ id: "lr1", status: "PENDING" });
    render(<AddMemberForm familyId="fam1" households={[]} />);
    await fillName();
    await userEvent.click(screen.getByRole("button", { name: /add member/i }));
    expect(mockCreateLR).toHaveBeenCalledWith(
      expect.objectContaining({ familyGroupId: "fam1", targetPersonId: "p1" }),
      expect.anything()
    );
    expect(await screen.findByText(/pending consent/i)).toBeInTheDocument();
  });

  it("shows the attestation box when a contact is entered, and hides the date-of-birth field", async () => {
    render(<AddMemberForm familyId="fam1" households={[]} />);
    expect(screen.queryByLabelText(/adult/i)).toBeNull();
    expect(screen.getByLabelText(/date of birth/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    expect(screen.getByLabelText(/adult/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/date of birth/i)).toBeNull();
  });

  it("blocks submit when both an email and a phone are entered", async () => {
    render(<AddMemberForm familyId="fam1" households={[]} />);
    await fillName();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/phone/i), "+15555550123");
    await userEvent.click(screen.getByRole("button", { name: /add member/i }));
    expect(mockCreateLR).not.toHaveBeenCalled();
    expect(mockCreatePerson).not.toHaveBeenCalled();
    expect(screen.getByText(/not both/i)).toBeInTheDocument();
  });

  it("sends carryHouseholdId on the link-request path only", async () => {
    mockCreateLR.mockResolvedValue({ id: "lr1", status: "PENDING" });
    render(<AddMemberForm familyId="fam1" households={[{ id: "h1", name: "Home" }]} />);
    await fillName();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.selectOptions(screen.getByLabelText(/also add to household/i), "h1");
    await userEvent.click(screen.getByRole("button", { name: /add member/i }));
    expect(mockCreateLR.mock.calls[0][0]).toMatchObject({ carryHouseholdId: "h1" });
  });
});

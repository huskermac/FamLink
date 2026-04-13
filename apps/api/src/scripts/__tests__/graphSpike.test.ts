/**
 * P2-01 graphSpike unit tests.
 *
 * Verifies the query helper functions with a mocked database.
 * The spike script itself (graphSpike.ts) runs against the real database
 * via `npx ts-node --transpile-only src/scripts/graphSpike.ts`.
 */

import type {
  FamilyMember,
  Person,
  Household,
  HouseholdMember,
  RSVP
} from "@famlink/db";

const mockFamilyMemberFindMany = vi.fn();
const mockHouseholdMemberFindMany = vi.fn();
const mockRsvpFindMany = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@famlink/db", () => ({
  db: {
    familyMember: { findMany: (...args: unknown[]) => mockFamilyMemberFindMany(...args) },
    householdMember: { findMany: (...args: unknown[]) => mockHouseholdMemberFindMany(...args) },
    rSVP: { findMany: (...args: unknown[]) => mockRsvpFindMany(...args) },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    $disconnect: vi.fn().mockResolvedValue(undefined)
  }
}));

import {
  queryDirectFamilyMembers,
  queryHouseholdMembers,
  queryRelationshipPath,
  queryRsvpAggregation
} from "../graphSpike";

const makePerson = (id: string, firstName: string, lastName: string): Person => ({
  id,
  firstName,
  lastName,
  userId: null,
  preferredName: null,
  dateOfBirth: null,
  ageGateLevel: "NONE",
  guardianPersonId: null,
  profilePhotoUrl: null,
  email: null,
  phone: null,
  fcmToken: null,
  createdAt: new Date(),
  updatedAt: new Date()
});

const SARAH = makePerson("person_sarah", "Sarah", "Johnson");
const TOM = makePerson("person_tom", "Tom", "Johnson");
const EMMA = makePerson("person_emma", "Emma", "Johnson");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("queryDirectFamilyMembers", () => {
  it("returns all family members except self", async () => {
    const members: Array<Partial<FamilyMember> & { person: Person }> = [
      { id: "fm1", personId: "person_sarah", familyGroupId: "fam", person: SARAH },
      { id: "fm2", personId: "person_tom", familyGroupId: "fam", person: TOM },
      { id: "fm3", personId: "person_emma", familyGroupId: "fam", person: EMMA }
    ];
    mockFamilyMemberFindMany.mockResolvedValue(members);

    const result = await queryDirectFamilyMembers("person_sarah", "fam");

    expect(result).toHaveLength(2);
    expect(result.every(m => m.id !== "person_sarah")).toBe(true);
    expect(result.map(m => m.firstName)).toContain("Tom");
    expect(result.map(m => m.firstName)).toContain("Emma");
  });

  it("returns empty array when person is the only member", async () => {
    const members: Array<Partial<FamilyMember> & { person: Person }> = [
      { id: "fm1", personId: "person_sarah", familyGroupId: "fam", person: SARAH }
    ];
    mockFamilyMemberFindMany.mockResolvedValue(members);

    const result = await queryDirectFamilyMembers("person_sarah", "fam");
    expect(result).toHaveLength(0);
  });
});

describe("queryHouseholdMembers", () => {
  const makeHousehold = (id: string, name: string): Household => ({
    id,
    name,
    familyGroupId: "fam",
    street: null,
    city: null,
    state: null,
    zip: null,
    country: "US",
    createdAt: new Date(),
    updatedAt: new Date()
  });

  it("returns co-residents excluding self", async () => {
    const myMemberships: Array<Partial<HouseholdMember> & { household: Household }> = [
      { householdId: "h1", personId: "person_sarah", household: makeHousehold("h1", "Main House") }
    ];

    const allMembers: Array<Partial<HouseholdMember> & { person: Person; household: Household }> = [
      { householdId: "h1", personId: "person_tom", person: TOM, household: makeHousehold("h1", "Main House") },
      { householdId: "h1", personId: "person_emma", person: EMMA, household: makeHousehold("h1", "Main House") }
    ];

    mockHouseholdMemberFindMany
      .mockResolvedValueOnce(myMemberships)
      .mockResolvedValueOnce(allMembers);

    const result = await queryHouseholdMembers("person_sarah");

    expect(result).toHaveLength(2);
    expect(result.map(m => m.firstName)).toContain("Tom");
    expect(result.map(m => m.householdName)).toContain("Main House");
  });

  it("returns empty array when person has no household memberships", async () => {
    mockHouseholdMemberFindMany.mockResolvedValueOnce([]);
    const result = await queryHouseholdMembers("person_nobody");
    expect(result).toHaveLength(0);
    expect(mockHouseholdMemberFindMany).toHaveBeenCalledTimes(1);
  });
});

describe("queryRelationshipPath (WITH RECURSIVE CTE)", () => {
  it("passes parameters to $queryRaw and returns path rows", async () => {
    const mockRows = [
      {
        fromPersonId: "person_sarah",
        toPersonId: "person_margaret",
        type: "CHILD",
        depth: 2,
        path: ["person_sarah", "person_tom", "person_margaret"],
        type_path: ["SPOUSE", "CHILD"]
      }
    ];
    mockQueryRaw.mockResolvedValue(mockRows);

    const result = await queryRelationshipPath(
      "person_sarah",
      "person_margaret",
      "family_johnson"
    );

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].depth).toBe(2);
    expect(result[0].path).toContain("person_sarah");
    expect(result[0].path).toContain("person_margaret");
  });

  it("returns empty array when no path exists", async () => {
    mockQueryRaw.mockResolvedValue([]);
    const result = await queryRelationshipPath(
      "person_sarah",
      "person_nonexistent",
      "family_johnson"
    );
    expect(result).toHaveLength(0);
  });
});

describe("queryRsvpAggregation", () => {
  it("groups RSVPs by status and includes PENDING for non-responders", async () => {
    const familyMembers: Array<Partial<FamilyMember> & { person: Person }> = [
      { personId: "p1", person: makePerson("p1", "Alice", "A") },
      { personId: "p2", person: makePerson("p2", "Bob", "B") },
      { personId: "p3", person: makePerson("p3", "Carol", "C") }
    ];
    const rsvps: Partial<RSVP>[] = [
      { personId: "p1", status: "YES", eventId: "ev1" },
      { personId: "p2", status: "NO", eventId: "ev1" }
      // p3 has no RSVP → should appear as PENDING
    ];

    mockFamilyMemberFindMany.mockResolvedValue(familyMembers);
    mockRsvpFindMany.mockResolvedValue(rsvps);

    const result = await queryRsvpAggregation("ev1", "fam");

    const byStatus = Object.fromEntries(result.map(r => [r.status, r]));
    expect(byStatus["YES"].count).toBe(1);
    expect(byStatus["NO"].count).toBe(1);
    expect(byStatus["PENDING"].count).toBe(1);
    expect(byStatus["PENDING"].names).toContain("Carol C");
  });

  it("returns total count equal to family member count", async () => {
    const familyMembers: Array<Partial<FamilyMember> & { person: Person }> = [
      { personId: "p1", person: makePerson("p1", "A", "X") },
      { personId: "p2", person: makePerson("p2", "B", "X") }
    ];
    mockFamilyMemberFindMany.mockResolvedValue(familyMembers);
    mockRsvpFindMany.mockResolvedValue([]);

    const result = await queryRsvpAggregation("ev1", "fam");
    const total = result.reduce((sum, g) => sum + g.count, 0);
    expect(total).toBe(2);
  });
});

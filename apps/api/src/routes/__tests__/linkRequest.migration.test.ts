import { db } from "@famlink/db";

describe("LinkRequest schema", () => {
  it("persists PENDING with the round-3 columns", async () => {
    const r = await db.linkRequest.create({ data: {
      kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: "f1",
      targetPersonId: "p1", requestedByPersonId: "p0",
      expiresAt: new Date(Date.now() + 86_400_000) } });
    expect(r.status).toBe("PENDING");
    expect(r.carryInSkipped).toBe(false);
    expect(r.deliveredContact).toBeNull();
    await db.linkRequest.delete({ where: { id: r.id } });
  });
  it("rejects a second PENDING membership request for the same (family,target)", async () => {
    const base = { kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: "f2",
      targetPersonId: "pX", requestedByPersonId: "p0", expiresAt: new Date(Date.now()+86_400_000) };
    const a = await db.linkRequest.create({ data: base });
    await expect(db.linkRequest.create({ data: base })).rejects.toThrow(); // partial unique index
    await db.linkRequest.delete({ where: { id: a.id } });
  });
});

import { db } from "@famlink/db";
import { describe, expect, it } from "vitest";

describe("Person contact partial uniqueness", () => {
  it("rejects two verified persons with the same normalized email", async () => {
    await db.person.create({
      data: {
        firstName: "A",
        lastName: "X",
        ageGateLevel: "ADULT",
        emailNormalized: "dup@x.com",
        emailVerifiedAt: new Date()
      }
    });

    await expect(
      db.person.create({
        data: {
          firstName: "B",
          lastName: "Y",
          ageGateLevel: "ADULT",
          emailNormalized: "dup@x.com",
          emailVerifiedAt: new Date()
        }
      })
    ).rejects.toThrow();
  });

  it("allows two unverified persons with the same normalized email", async () => {
    await db.person.create({
      data: {
        firstName: "C",
        lastName: "X",
        ageGateLevel: "ADULT",
        emailNormalized: "shared@x.com"
      }
    });

    await expect(
      db.person.create({
        data: {
          firstName: "D",
          lastName: "Y",
          ageGateLevel: "ADULT",
          emailNormalized: "shared@x.com"
        }
      })
    ).resolves.toBeTruthy();
  });
});

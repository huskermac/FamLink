import { db, type Person } from "@famlink/db";
import { normalizeEmail, normalizePhone } from "./contact";

function splitName(name?: string | null): { firstName: string; lastName: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Guest", lastName: "-" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "-" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function findOrCreatePersonByContact(input: {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}): Promise<Person> {
  const emailNormalized = normalizeEmail(input.email);
  const phoneNormalized = normalizePhone(input.phone);

  if (emailNormalized || phoneNormalized) {
    const matches = await db.person.findMany({
      where: {
        OR: [
          ...(emailNormalized ? [{ emailNormalized }] : []),
          ...(phoneNormalized ? [{ phoneNormalized }] : [])
        ]
      }
    });

    if (matches.length > 0) {
      const verified = matches.find(
        (person) =>
          (emailNormalized &&
            person.emailNormalized === emailNormalized &&
            person.emailVerifiedAt !== null) ||
          (phoneNormalized &&
            person.phoneNormalized === phoneNormalized &&
            person.phoneVerifiedAt !== null)
      );
      return verified ?? matches[0];
    }
  }

  const { firstName, lastName } = splitName(input.name);
  return db.person.create({
    data: {
      userId: null,
      firstName,
      lastName,
      ageGateLevel: "ADULT",
      emailNormalized,
      phoneNormalized
    }
  });
}

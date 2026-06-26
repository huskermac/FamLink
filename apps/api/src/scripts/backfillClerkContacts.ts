/**
 * One-time Contact Identity Foundation backfill from Clerk.
 *
 * Dry run:
 *   npx ts-node --transpile-only src/scripts/backfillClerkContacts.ts
 *
 * Apply:
 *   npx ts-node --transpile-only src/scripts/backfillClerkContacts.ts --apply
 */

import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../../.env.local"), override: false });

import { createClerkClient, type User } from "@clerk/backend";
import { db } from "@famlink/db";
import { normalizeEmail, normalizePhone } from "../lib/contact";
import { env } from "../lib/env";

const PAGE_LIMIT = 100;

interface Summary {
  clerkUsersSeen: number;
  missingPerson: number;
  noVerifiedContact: number;
  alreadyCurrent: number;
  wouldUpdate: number;
  updated: number;
  errors: number;
}

function hasVerifiedPrimaryEmail(user: User): boolean {
  return user.primaryEmailAddress?.verification?.status === "verified";
}

function hasVerifiedPrimaryPhone(user: User): boolean {
  return user.primaryPhoneNumber?.verification?.status === "verified";
}

function verifiedEmailNormalized(user: User): string | null {
  if (!hasVerifiedPrimaryEmail(user)) return null;
  return normalizeEmail(user.primaryEmailAddress?.emailAddress);
}

function verifiedPhoneNormalized(user: User): string | null {
  if (!hasVerifiedPrimaryPhone(user)) return null;
  return normalizePhone(user.primaryPhoneNumber?.phoneNumber);
}

async function backfillUser(user: User, apply: boolean, summary: Summary): Promise<void> {
  summary.clerkUsersSeen += 1;

  const person = await db.person.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      emailNormalized: true,
      phoneNormalized: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true
    }
  });

  if (!person) {
    summary.missingPerson += 1;
    return;
  }

  const emailNormalized = verifiedEmailNormalized(user);
  const phoneNormalized = verifiedPhoneNormalized(user);

  if (!emailNormalized && !phoneNormalized) {
    summary.noVerifiedContact += 1;
    return;
  }

  const now = new Date();
  const data: {
    emailNormalized?: string;
    phoneNormalized?: string;
    emailVerifiedAt?: Date;
    phoneVerifiedAt?: Date;
  } = {};

  if (emailNormalized) {
    if (person.emailNormalized !== emailNormalized) data.emailNormalized = emailNormalized;
    if (!person.emailVerifiedAt) data.emailVerifiedAt = now;
  }

  if (phoneNormalized) {
    if (person.phoneNormalized !== phoneNormalized) data.phoneNormalized = phoneNormalized;
    if (!person.phoneVerifiedAt) data.phoneVerifiedAt = now;
  }

  if (Object.keys(data).length === 0) {
    summary.alreadyCurrent += 1;
    return;
  }

  if (!apply) {
    summary.wouldUpdate += 1;
    return;
  }

  await db.person.update({
    where: { id: person.id },
    data
  });
  summary.updated += 1;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const summary: Summary = {
    clerkUsersSeen: 0,
    missingPerson: 0,
    noVerifiedContact: 0,
    alreadyCurrent: 0,
    wouldUpdate: 0,
    updated: 0,
    errors: 0
  };

  console.log(`Backfilling Clerk verified contacts into Person (${apply ? "apply" : "dry-run"})...`);

  for (let offset = 0; ; offset += PAGE_LIMIT) {
    const page = await clerk.users.getUserList({ limit: PAGE_LIMIT, offset });
    for (const user of page.data) {
      try {
        await backfillUser(user, apply, summary);
      } catch (err) {
        summary.errors += 1;
        console.error(`Failed to backfill Clerk user ${user.id}:`, err);
      }
    }

    if (offset + page.data.length >= page.totalCount || page.data.length === 0) break;
  }

  console.log(summary);
  if (!apply) {
    console.log("Dry run only. Re-run with --apply to write updates.");
  }
}

if (require.main === module) {
  main()
    .catch(err => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}

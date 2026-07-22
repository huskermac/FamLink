import { db } from "@famlink/db";

/**
 * Run before PR-2 ships (before any second household link can be created — expand and
 * contract migrations apply back-to-back in a single `prisma migrate deploy`, so there is no
 * expand-only moment). Until then the backfill invariant is exactly-one-link-per-household, so
 * BOTH checks must hold (once multi-links are possible, totalLinks > households legitimately).
 */
async function main() {
  const households = await db.household.count();
  const linked = await db.household.count({ where: { families: { some: {} } } });
  const links = await db.householdFamily.count();
  console.log(JSON.stringify({ households, householdsWithAtLeastOneLink: linked, totalLinks: links }));
  let failed = false;
  if (linked !== households) {
    const orphans = await db.household.findMany({ where: { families: { none: {} } }, select: { id: true } });
    console.error(`ORPHANS (no link): ${orphans.map((o) => o.id).join(", ")}`);
    failed = true;
  }
  if (links !== households) {
    console.error(`COUNT MISMATCH: expected exactly one link per household post-backfill (households=${households}, links=${links})`);
    failed = true;
  }
  if (failed) process.exit(1);
}

main().finally(() => db.$disconnect());

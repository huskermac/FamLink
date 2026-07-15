import { db } from "@famlink/db";

/**
 * Run IMMEDIATELY after the expand migration, before any new links are created:
 * at that moment the backfill invariant is exactly-one-link-per-household, so
 * BOTH checks must hold (later, multi-links legitimately make totalLinks > households).
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

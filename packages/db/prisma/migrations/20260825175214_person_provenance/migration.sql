-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "createdByFamilyGroupId" TEXT;

-- Backfill (hand-appended): a passive person (userId IS NULL) who is a member of
-- exactly one family gets that family stamped as the owner. A passive person in
-- more than one family stays null on purpose — an arbitrary pick does not prove
-- authorship. Null-owner passive persons are attached only via a consented
-- LinkRequest. Prod is tiny (~12 persons), so a single pass is safe.
UPDATE "Person" p
SET "createdByFamilyGroupId" = (
  SELECT fm."familyGroupId" FROM "FamilyMember" fm WHERE fm."personId" = p."id"
)
WHERE p."userId" IS NULL
  AND p."createdByFamilyGroupId" IS NULL
  AND (SELECT COUNT(*) FROM "FamilyMember" fm WHERE fm."personId" = p."id") = 1;

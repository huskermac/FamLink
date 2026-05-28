/*
  Warnings:

  - A unique constraint covering the columns `[fromPersonId,toPersonId,familyGroupId,type]` on the table `Relationship` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable: add temporal fields to Relationship
ALTER TABLE "Relationship" ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "endReason" TEXT,
ADD COLUMN     "forgottenAt" TIMESTAMP(3),
ADD COLUMN     "qualifier" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3);

-- AlterTable: add deceased fields to Person
ALTER TABLE "Person" ADD COLUMN     "dateOfDeath" TIMESTAMP(3),
ADD COLUMN     "deceasedDisplayMode" TEXT,
ADD COLUMN     "deceasedShowBirthdayRemembrance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isDeceased" BOOLEAN NOT NULL DEFAULT false;

-- DropIndex
DROP INDEX "Relationship_fromPersonId_toPersonId_familyGroupId_key";

-- Data migration: rename FAMILY_FRIEND → FRIEND
UPDATE "Relationship" SET "type" = 'FRIEND', "updatedAt" = NOW() WHERE "type" = 'FAMILY_FRIEND';

-- Data migration: EX_SPOUSE → SPOUSE with endDate + endReason
UPDATE "Relationship"
SET "type" = 'SPOUSE',
    "endDate" = NULL,
    "endReason" = 'DIVORCE',
    "updatedAt" = NOW()
WHERE "type" = 'EX_SPOUSE';

-- Data migration: compound parent/sibling types → base type + qualifier
UPDATE "Relationship" SET "type" = 'PARENT',  "qualifier" = 'STEP',     "updatedAt" = NOW() WHERE "type" = 'STEP_PARENT';
UPDATE "Relationship" SET "type" = 'CHILD',   "qualifier" = 'STEP',     "updatedAt" = NOW() WHERE "type" = 'STEP_CHILD';
UPDATE "Relationship" SET "type" = 'SIBLING', "qualifier" = 'STEP',     "updatedAt" = NOW() WHERE "type" = 'STEP_SIBLING';
UPDATE "Relationship" SET "type" = 'SIBLING', "qualifier" = 'HALF',     "updatedAt" = NOW() WHERE "type" = 'HALF_SIBLING';
UPDATE "Relationship" SET "type" = 'PARENT',  "qualifier" = 'ADOPTIVE', "updatedAt" = NOW() WHERE "type" = 'ADOPTIVE_PARENT';
UPDATE "Relationship" SET "type" = 'CHILD',   "qualifier" = 'ADOPTIVE', "updatedAt" = NOW() WHERE "type" = 'ADOPTIVE_CHILD';

-- CreateIndex (after all data migrations so duplicates are resolved before uniqueness is enforced)
CREATE UNIQUE INDEX "Relationship_fromPersonId_toPersonId_familyGroupId_type_key" ON "Relationship"("fromPersonId", "toPersonId", "familyGroupId", "type");

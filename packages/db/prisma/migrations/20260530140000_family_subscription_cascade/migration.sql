-- AlterTable: change FK to cascade delete
ALTER TABLE "FamilySubscription" DROP CONSTRAINT "FamilySubscription_familyGroupId_fkey";
ALTER TABLE "FamilySubscription" ADD CONSTRAINT "FamilySubscription_familyGroupId_fkey"
  FOREIGN KEY ("familyGroupId") REFERENCES "FamilyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "Household" DROP CONSTRAINT "Household_familyGroupId_fkey";

-- DropIndex
DROP INDEX "Household_familyGroupId_idx";

-- AlterTable
ALTER TABLE "Household" DROP COLUMN "familyGroupId";

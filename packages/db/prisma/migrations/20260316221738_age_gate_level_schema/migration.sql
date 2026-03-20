/*
  Warnings:

  - You are about to drop the column `isMinor` on the `Person` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Person" DROP COLUMN "isMinor",
ADD COLUMN     "ageGateLevel" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "guardianPersonId" TEXT;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_guardianPersonId_fkey" FOREIGN KEY ("guardianPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

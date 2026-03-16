/*
  Warnings:

  - A unique constraint covering the columns `[fromPersonId,toPersonId,familyGroupId]` on the table `Relationship` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Relationship` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Relationship" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Relationship_fromPersonId_toPersonId_familyGroupId_key" ON "Relationship"("fromPersonId", "toPersonId", "familyGroupId");

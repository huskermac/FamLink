/*
  Warnings:

  - You are about to drop the column `createdById` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `locationAddr` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `locationUrl` on the `Event` table. All the data in the column will be lost.
  - Added the required column `createdByPersonId` to the `Event` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Event` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_createdById_fkey";

-- AlterTable
ALTER TABLE "Event" DROP COLUMN "createdById",
DROP COLUMN "locationAddr",
DROP COLUMN "locationUrl",
ADD COLUMN     "birthdayPersonId" TEXT,
ADD COLUMN     "createdByPersonId" TEXT NOT NULL,
ADD COLUMN     "isBirthdayEvent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationAddress" TEXT,
ADD COLUMN     "locationMapUrl" TEXT,
ADD COLUMN     "recurrenceRule" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "EventInvitation" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "personId" TEXT,
    "householdId" TEXT,
    "scope" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RSVP" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "guestToken" TEXT,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RSVP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PotluckAssignment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "personId" TEXT,
    "item" TEXT NOT NULL,
    "quantity" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PotluckAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventInvitation_eventId_idx" ON "EventInvitation"("eventId");

-- CreateIndex
CREATE INDEX "EventInvitation_personId_idx" ON "EventInvitation"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "RSVP_guestToken_key" ON "RSVP"("guestToken");

-- CreateIndex
CREATE INDEX "RSVP_eventId_idx" ON "RSVP"("eventId");

-- CreateIndex
CREATE INDEX "RSVP_guestToken_idx" ON "RSVP"("guestToken");

-- CreateIndex
CREATE UNIQUE INDEX "RSVP_eventId_personId_key" ON "RSVP"("eventId", "personId");

-- CreateIndex
CREATE INDEX "PotluckAssignment_eventId_idx" ON "PotluckAssignment"("eventId");

-- CreateIndex
CREATE INDEX "Event_familyGroupId_idx" ON "Event"("familyGroupId");

-- CreateIndex
CREATE INDEX "Event_startAt_idx" ON "Event"("startAt");

-- AddForeignKey
ALTER TABLE "EventInvitation" ADD CONSTRAINT "EventInvitation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PotluckAssignment" ADD CONSTRAINT "PotluckAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

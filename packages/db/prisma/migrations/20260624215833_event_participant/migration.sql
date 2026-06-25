-- CreateEnum
CREATE TYPE "EventRole" AS ENUM ('PARTICIPANT', 'EVENT_ADMIN');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- AlterTable
ALTER TABLE "EventInvitation" ADD COLUMN     "role" "EventRole";

-- AlterTable
ALTER TABLE "Person" ALTER COLUMN "ageGateLevel" SET DEFAULT 'ADULT';

-- CreateTable
CREATE TABLE "EventParticipant" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "EventRole" NOT NULL DEFAULT 'PARTICIPANT',
    "status" "ParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventParticipant_eventId_idx" ON "EventParticipant"("eventId");

-- CreateIndex
CREATE INDEX "EventParticipant_personId_idx" ON "EventParticipant"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_eventId_personId_key" ON "EventParticipant"("eventId", "personId");

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

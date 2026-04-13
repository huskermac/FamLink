-- CreateEnum
CREATE TYPE "EventItemStatus" AS ENUM ('UNCLAIMED', 'CLAIMED', 'PROVIDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventItemVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateTable
CREATE TABLE "EventItem" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdByPersonId" TEXT NOT NULL,
    "assignedToPersonId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" TEXT,
    "notes" TEXT,
    "isChecklistItem" BOOLEAN NOT NULL DEFAULT false,
    "status" "EventItemStatus" NOT NULL DEFAULT 'UNCLAIMED',
    "visibility" "EventItemVisibility" NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventItem_eventId_idx" ON "EventItem"("eventId");

-- CreateIndex
CREATE INDEX "EventItem_assignedToPersonId_idx" ON "EventItem"("assignedToPersonId");

-- AddForeignKey
ALTER TABLE "EventItem" ADD CONSTRAINT "EventItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventItem" ADD CONSTRAINT "EventItem_createdByPersonId_fkey" FOREIGN KEY ("createdByPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventItem" ADD CONSTRAINT "EventItem_assignedToPersonId_fkey" FOREIGN KEY ("assignedToPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropTable
DROP TABLE "PotluckAssignment";

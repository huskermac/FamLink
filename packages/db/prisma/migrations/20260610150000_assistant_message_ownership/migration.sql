-- P3-00: AssistantMessage gains owner scoping (personId + familyGroupId).
-- Pre-existing rows have no recorded owner and cannot be backfilled — deleted
-- per decision of 2026-06-10 (beta-era test conversations only).
DELETE FROM "AssistantMessage";

-- AlterTable
ALTER TABLE "AssistantMessage" ADD COLUMN     "personId" TEXT NOT NULL,
ADD COLUMN     "familyGroupId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "AssistantMessage_personId_idx" ON "AssistantMessage"("personId");

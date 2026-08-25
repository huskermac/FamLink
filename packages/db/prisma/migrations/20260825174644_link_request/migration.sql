-- CreateTable
CREATE TABLE "LinkRequest" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "familyGroupId" TEXT NOT NULL,
    "targetPersonId" TEXT,
    "targetHouseholdId" TEXT,
    "carryHouseholdId" TEXT,
    "carryInSkipped" BOOLEAN NOT NULL DEFAULT false,
    "requestedByPersonId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "consentedByPersonId" TEXT,
    "consentChannel" TEXT,
    "token" TEXT,
    "tokenChannel" TEXT,
    "deliveredContact" TEXT,
    "attestedAdult" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LinkRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkRequest_token_key" ON "LinkRequest"("token");

-- CreateIndex
CREATE INDEX "LinkRequest_familyGroupId_status_idx" ON "LinkRequest"("familyGroupId", "status");

-- CreateIndex
CREATE INDEX "LinkRequest_targetPersonId_status_idx" ON "LinkRequest"("targetPersonId", "status");

-- CreateIndex
CREATE INDEX "LinkRequest_targetHouseholdId_status_idx" ON "LinkRequest"("targetHouseholdId", "status");

-- Partial unique indexes (hand-appended; Prisma cannot emit partial indexes):
-- guard against a second PENDING request for the same (family, target).
CREATE UNIQUE INDEX "LinkRequest_pending_membership_uq"
  ON "LinkRequest" ("familyGroupId", "targetPersonId")
  WHERE "status" = 'PENDING' AND "kind" = 'FAMILY_MEMBERSHIP';
CREATE UNIQUE INDEX "LinkRequest_pending_household_uq"
  ON "LinkRequest" ("familyGroupId", "targetHouseholdId")
  WHERE "status" = 'PENDING' AND "kind" = 'HOUSEHOLD_LINK';

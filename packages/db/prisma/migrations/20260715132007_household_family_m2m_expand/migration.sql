-- CreateTable
CREATE TABLE "HouseholdFamily" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "familyGroupId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedByPersonId" TEXT,

    CONSTRAINT "HouseholdFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdAuditEntry" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "actorPersonId" TEXT NOT NULL,
    "actorFamilyGroupId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HouseholdFamily_familyGroupId_idx" ON "HouseholdFamily"("familyGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdFamily_householdId_familyGroupId_key" ON "HouseholdFamily"("householdId", "familyGroupId");

-- CreateIndex
CREATE INDEX "HouseholdAuditEntry_householdId_createdAt_idx" ON "HouseholdAuditEntry"("householdId", "createdAt");

-- AddForeignKey
ALTER TABLE "HouseholdFamily" ADD CONSTRAINT "HouseholdFamily_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdFamily" ADD CONSTRAINT "HouseholdFamily_familyGroupId_fkey" FOREIGN KEY ("familyGroupId") REFERENCES "FamilyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: exactly one link per existing household, from its current FK.
INSERT INTO "HouseholdFamily" ("id", "householdId", "familyGroupId", "linkedAt")
SELECT 'hf_' || "id", "id", "familyGroupId", "createdAt"
FROM "Household";

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "preferredName" TEXT,
    "dateOfBirth" DATE,
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "profilePhotoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultVisibility" TEXT NOT NULL DEFAULT 'FAMILY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "familyGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "street" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "country" TEXT DEFAULT 'US',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL,
    "familyGroupId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "roles" TEXT[],
    "permissions" TEXT[],
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "notifType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL,
    "fromPersonId" TEXT NOT NULL,
    "toPersonId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "familyGroupId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "familyGroupId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "locationName" TEXT,
    "locationAddr" TEXT,
    "locationUrl" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'FAMILY',
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_userId_key" ON "Person"("userId");

-- CreateIndex
CREATE INDEX "Person_userId_idx" ON "Person"("userId");

-- CreateIndex
CREATE INDEX "Household_familyGroupId_idx" ON "Household"("familyGroupId");

-- CreateIndex
CREATE INDEX "FamilyMember_familyGroupId_idx" ON "FamilyMember"("familyGroupId");

-- CreateIndex
CREATE INDEX "FamilyMember_personId_idx" ON "FamilyMember"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyMember_familyGroupId_personId_key" ON "FamilyMember"("familyGroupId", "personId");

-- CreateIndex
CREATE INDEX "HouseholdMember_householdId_idx" ON "HouseholdMember"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdMember_householdId_personId_key" ON "HouseholdMember"("householdId", "personId");

-- CreateIndex
CREATE INDEX "NotificationPreference_personId_idx" ON "NotificationPreference"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_personId_channel_notifType_key" ON "NotificationPreference"("personId", "channel", "notifType");

-- CreateIndex
CREATE INDEX "Relationship_familyGroupId_idx" ON "Relationship"("familyGroupId");

-- CreateIndex
CREATE INDEX "Relationship_fromPersonId_idx" ON "Relationship"("fromPersonId");

-- CreateIndex
CREATE INDEX "Relationship_toPersonId_idx" ON "Relationship"("toPersonId");

-- AddForeignKey
ALTER TABLE "FamilyGroup" ADD CONSTRAINT "FamilyGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Household" ADD CONSTRAINT "Household_familyGroupId_fkey" FOREIGN KEY ("familyGroupId") REFERENCES "FamilyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_familyGroupId_fkey" FOREIGN KEY ("familyGroupId") REFERENCES "FamilyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_fromPersonId_fkey" FOREIGN KEY ("fromPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_toPersonId_fkey" FOREIGN KEY ("toPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_familyGroupId_fkey" FOREIGN KEY ("familyGroupId") REFERENCES "FamilyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_familyGroupId_fkey" FOREIGN KEY ("familyGroupId") REFERENCES "FamilyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

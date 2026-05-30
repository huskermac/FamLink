-- CreateTable
CREATE TABLE "PricingTier" (
    "tierKey" TEXT NOT NULL,
    "stripePriceId" TEXT,
    "stripeSeatPriceId" TEXT,
    "activeUserLimit" INTEGER,
    "trialDays" INTEGER,
    "trialWarningDays" INTEGER,
    "downgradeGraceDays" INTEGER NOT NULL DEFAULT 7,
    "displayName" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PricingTier_pkey" PRIMARY KEY ("tierKey")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "stripeCouponId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "eligibleTierKeys" TEXT[],
    "isStackable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilySubscription" (
    "id" TEXT NOT NULL,
    "familyGroupId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "tierKey" TEXT NOT NULL,
    "seatCount" INTEGER NOT NULL DEFAULT 1,
    "grandfathered" BOOLEAN NOT NULL DEFAULT false,
    "priceLockedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "trialEndsAt" TIMESTAMP(3),
    "trialWarningSentAt" TIMESTAMP(3),
    "pendingDowngradeTierKey" TEXT,
    "pendingDowngradeSeatCount" INTEGER,
    "downgradeGraceEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FamilySubscription_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "FamilyMember" ADD COLUMN "suspendedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "FamilySubscription_familyGroupId_key" ON "FamilySubscription"("familyGroupId");

-- AddForeignKey
ALTER TABLE "FamilySubscription" ADD CONSTRAINT "FamilySubscription_familyGroupId_fkey"
  FOREIGN KEY ("familyGroupId") REFERENCES "FamilyGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilySubscription" ADD CONSTRAINT "FamilySubscription_tierKey_fkey"
  FOREIGN KEY ("tierKey") REFERENCES "PricingTier"("tierKey") ON DELETE RESTRICT ON UPDATE CASCADE;

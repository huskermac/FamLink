-- CreateTable
CREATE TABLE "SmsConsent" (
    "id" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "optedOutAt" TIMESTAMP(3),
    "optedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsConsent_phoneNormalized_key" ON "SmsConsent"("phoneNormalized");

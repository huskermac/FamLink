-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "emailNormalized" TEXT,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "phoneNormalized" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Person_emailNormalized_idx" ON "Person"("emailNormalized");

-- CreateIndex
CREATE INDEX "Person_phoneNormalized_idx" ON "Person"("phoneNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Person_emailNormalized_verified_key"
  ON "Person"("emailNormalized") WHERE "emailVerifiedAt" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Person_phoneNormalized_verified_key"
  ON "Person"("phoneNormalized") WHERE "phoneVerifiedAt" IS NOT NULL;

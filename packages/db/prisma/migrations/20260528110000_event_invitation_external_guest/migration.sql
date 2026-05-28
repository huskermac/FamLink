-- AlterTable: extend EventInvitation for external guests
ALTER TABLE "EventInvitation"
ADD COLUMN "invitedById"    TEXT,
ADD COLUMN "guestEmail"     TEXT,
ADD COLUMN "guestPhone"     TEXT,
ADD COLUMN "guestName"      TEXT,
ADD COLUMN "guestToken"     TEXT,
ADD COLUMN "linkedPersonId" TEXT,
ADD COLUMN "status"         TEXT NOT NULL DEFAULT 'PENDING';

-- AlterTable: add default to scope column
ALTER TABLE "EventInvitation" ALTER COLUMN "scope" SET DEFAULT 'INDIVIDUAL';

-- CreateIndex
CREATE UNIQUE INDEX "EventInvitation_guestToken_key" ON "EventInvitation"("guestToken");

-- CreateIndex
CREATE INDEX "EventInvitation_guestToken_idx" ON "EventInvitation"("guestToken");

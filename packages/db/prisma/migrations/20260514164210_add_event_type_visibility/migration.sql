-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('HOLIDAY', 'BIRTHDAY', 'SPORTS', 'SCHOOL', 'OTHER');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('BROADCAST', 'OPEN', 'PRIVATE');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "eventType" "EventType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "eventVisibility" "EventVisibility" NOT NULL DEFAULT 'BROADCAST';

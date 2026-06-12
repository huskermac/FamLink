-- P3-00: seats covered by the base price (decision 2026-06-12) — only seats
-- beyond includedSeats are billed on the per-seat Stripe price.
-- AlterTable
ALTER TABLE "PricingTier" ADD COLUMN     "includedSeats" INTEGER NOT NULL DEFAULT 1;

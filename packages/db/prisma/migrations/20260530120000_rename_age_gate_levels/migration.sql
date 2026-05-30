-- Rename ageGateLevel values to clearer age-tier labels
-- NONE -> ADULT (18+), YOUNG_ADULT -> TEEN (12-17), MINOR -> CHILD (<12)

UPDATE "Person" SET "ageGateLevel" = 'ADULT' WHERE "ageGateLevel" = 'NONE';
UPDATE "Person" SET "ageGateLevel" = 'TEEN'  WHERE "ageGateLevel" = 'YOUNG_ADULT';
UPDATE "Person" SET "ageGateLevel" = 'CHILD' WHERE "ageGateLevel" = 'MINOR';

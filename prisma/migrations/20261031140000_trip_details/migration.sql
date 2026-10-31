-- Destination and dates are required. Filling existing rows with a placeholder
-- would invent a trip. Nothing deployed has trips (the auth migration already
-- refuses to continue when Trip has rows). Fail here too, instead of writing
-- values the traveler never entered. Postgres also rejects the NOT NULL add
-- when rows exist, so a missed guard still cannot store an empty trip.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Trip") THEN
    RAISE EXCEPTION 'Trip already has rows, so destination, startDate, and endDate cannot be added without values';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN "destination" TEXT NOT NULL,
ADD COLUMN "startDate" DATE NOT NULL,
ADD COLUMN "endDate" DATE NOT NULL;

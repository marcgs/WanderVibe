-- The trip list reads one owner's rows ordered by start date.
CREATE INDEX "Trip_ownerId_startDate_idx" ON "Trip"("ownerId", "startDate");

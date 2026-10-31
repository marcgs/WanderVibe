import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("the trip details migration fails when rows exist and adds no default", () => {
  const sql = readFileSync(
    "prisma/migrations/20261031140000_trip_details/migration.sql",
    "utf8",
  );

  expect(sql).toMatch(/RAISE EXCEPTION/);
  expect(sql).toContain("destination, startDate, and endDate");
  expect(sql).toMatch(/ADD COLUMN "destination" TEXT NOT NULL/);
  expect(sql).toMatch(/ADD COLUMN "startDate" DATE NOT NULL/);
  expect(sql).toMatch(/ADD COLUMN "endDate" DATE NOT NULL/);
  expect(sql.toLowerCase()).not.toContain("default");
});

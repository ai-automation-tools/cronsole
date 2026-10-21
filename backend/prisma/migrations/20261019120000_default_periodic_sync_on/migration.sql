-- Periodic sync on by default (30 min). Turning it off is still NULL.
-- Backfill: until now NULL meant both "never chose" and "chose off"; the feature
-- shipped 2026-10-16, so every NULL is treated as "never chose". Native is skipped:
-- AutoSync ignores it and the route refuses to set it.
ALTER TABLE "PlatformConnection" ALTER COLUMN "syncIntervalMin" SET DEFAULT 30;
UPDATE "PlatformConnection" SET "syncIntervalMin" = 30
WHERE "syncIntervalMin" IS NULL AND "platform" <> 'TASKHUB_NATIVE';

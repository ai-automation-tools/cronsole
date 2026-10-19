-- Periodic sync: opt-in, per connection. NULL interval (every existing row) = off.
ALTER TABLE "PlatformConnection" ADD COLUMN "syncIntervalMin" INTEGER,
ADD COLUMN "autoSyncAt" TIMESTAMP(3),
ADD COLUMN "autoSyncError" TEXT;

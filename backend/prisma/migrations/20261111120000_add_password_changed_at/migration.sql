-- A password change ends every browser session issued before it.
--
-- NULL (every existing row) means "never changed", which refuses nothing, so no
-- backfill and no session is ended by applying this.
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

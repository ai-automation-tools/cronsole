-- Prune-on-sync provenance flag.
-- true  = auto-synced from the bundled/registry catalog (catalogSync owns it and
--         may prune it when it is no longer `core`).
-- false = user-authored (imported / saved-as-template) — never pruned.
ALTER TABLE "Template" ADD COLUMN "managed" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: every template that exists before import-protection was auto-synced
-- from the catalog (there was no separate provenance yet), so mark them managed.
-- catalogSync then reconciles them to the current `core` set on the next sync.
-- Future imports default to false and are protected.
UPDATE "Template" SET "managed" = true;

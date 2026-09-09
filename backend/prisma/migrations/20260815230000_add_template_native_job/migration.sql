-- A full Cronsole-native job spec for templates whose action is not a command
-- line: SCRIPT (the body IS the template) and CHECK (a probe plus what it must
-- equal). Nullable and additive — every existing template keeps resolving
-- through `command` / `commandTemplate` unchanged.
ALTER TABLE "Template" ADD COLUMN "nativeJob" JSONB;

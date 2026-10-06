-- Phone shortcuts: an API token that may only run one task.
--
-- NULL (every existing row) keeps today's meaning — a full-account token — so
-- no backfill. No foreign key on purpose; see `ApiToken.runTaskId` in
-- schema.prisma for why SetNull and Cascade are both wrong here.
ALTER TABLE "ApiToken" ADD COLUMN "runTaskId" TEXT;

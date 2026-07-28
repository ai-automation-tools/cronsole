-- Remembers a task the user removed from TaskHub while it still exists on the
-- platform ("untrack"), so the next sync that includes its category does not
-- silently re-import it. Without this, untrack would appear not to work: the
-- re-import is correct by the sync's own logic and indistinguishable from a bug.
--
-- Keyed on the platform-native `externalId` (the same identity as
-- Task.@@unique([platform, externalId])), never on the user-renameable
-- `category` — see docs/troubleshooting/README.md #20a. Subtractive only: an
-- exclusion can remove a task from a sync, never add one, so "which categories
-- do we sync" still has exactly one definition. See docs/ROADMAP.md › "Untrack".

-- CreateTable
CREATE TABLE "TaskExclusion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "PlatformType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskExclusion_userId_platform_idx" ON "TaskExclusion"("userId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "TaskExclusion_userId_platform_externalId_key" ON "TaskExclusion"("userId", "platform", "externalId");

-- AddForeignKey
ALTER TABLE "TaskExclusion" ADD CONSTRAINT "TaskExclusion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

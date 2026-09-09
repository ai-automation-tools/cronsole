-- CreateTable
--
-- The task definition captured immediately before a delete, so a destroyed task
-- can be rebuilt. Deliberately carries NO foreign key to "Task": the archive has
-- to outlive the row it describes, and a cascade would drop the backup in the
-- same transaction that made it necessary. "taskId" is a record of the id the
-- task had, not a pointer to a live row.
CREATE TABLE "DeletedTaskArchive" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "platform" "PlatformType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bundle" JSONB NOT NULL,
    "executions" JSONB NOT NULL,
    "deletedVia" TEXT NOT NULL DEFAULT 'api',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedTaskArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeletedTaskArchive_userId_createdAt_idx" ON "DeletedTaskArchive"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DeletedTaskArchive_userId_platform_externalId_idx" ON "DeletedTaskArchive"("userId", "platform", "externalId");

-- AddForeignKey
ALTER TABLE "DeletedTaskArchive" ADD CONSTRAINT "DeletedTaskArchive_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

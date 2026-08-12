-- CreateTable
CREATE TABLE "TaskFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskFavorite_userId_idx" ON "TaskFavorite"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskFavorite_userId_taskId_key" ON "TaskFavorite"("userId", "taskId");

-- AddForeignKey
ALTER TABLE "TaskFavorite" ADD CONSTRAINT "TaskFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskFavorite" ADD CONSTRAINT "TaskFavorite_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

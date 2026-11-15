-- CreateTable
CREATE TABLE "TaskHidden" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskHidden_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskHidden_userId_idx" ON "TaskHidden"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskHidden_userId_taskId_key" ON "TaskHidden"("userId", "taskId");

-- AddForeignKey
ALTER TABLE "TaskHidden" ADD CONSTRAINT "TaskHidden_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskHidden" ADD CONSTRAINT "TaskHidden_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

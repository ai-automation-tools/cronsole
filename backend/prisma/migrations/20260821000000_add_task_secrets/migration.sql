-- CreateTable
CREATE TABLE "TaskSecret" (
    "taskId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskSecret_pkey" PRIMARY KEY ("taskId")
);

-- AddForeignKey
ALTER TABLE "TaskSecret" ADD CONSTRAINT "TaskSecret_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TaskCollection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCollectionMember" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskCollectionMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskCollection_userId_idx" ON "TaskCollection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCollection_userId_name_key" ON "TaskCollection"("userId", "name");

-- CreateIndex
CREATE INDEX "TaskCollectionMember_collectionId_idx" ON "TaskCollectionMember"("collectionId");

-- CreateIndex
CREATE INDEX "TaskCollectionMember_taskId_idx" ON "TaskCollectionMember"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCollectionMember_collectionId_taskId_key" ON "TaskCollectionMember"("collectionId", "taskId");

-- AddForeignKey
ALTER TABLE "TaskCollection" ADD CONSTRAINT "TaskCollection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCollectionMember" ADD CONSTRAINT "TaskCollectionMember_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "TaskCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCollectionMember" ADD CONSTRAINT "TaskCollectionMember_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

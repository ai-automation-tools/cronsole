-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'Uncategorized';

-- CreateIndex
CREATE INDEX "Task_category_idx" ON "Task"("category");

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

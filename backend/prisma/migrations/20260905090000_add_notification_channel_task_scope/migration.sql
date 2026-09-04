-- AlterTable
ALTER TABLE "NotificationChannel" ADD COLUMN "taskIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

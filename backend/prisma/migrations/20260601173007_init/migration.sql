-- CreateEnum
CREATE TYPE "PlatformType" AS ENUM ('WINDOWS_TASK_SCHEDULER', 'CLAUDE_CODE', 'CHATGPT', 'JULES', 'OPEN_CLAW', 'HERMES');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('ACTIVE', 'DISABLED', 'UNKNOWN', 'DELETED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('SUCCESS', 'FAILURE', 'TIMEOUT', 'PENDING');

-- CreateEnum
CREATE TYPE "HealthState" AS ENUM ('HEALTHY', 'DEGRADED', 'OFFLINE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "PlatformType" NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSync" TIMESTAMP(3),
    "healthState" "HealthState" NOT NULL DEFAULT 'HEALTHY',
    "healthReason" TEXT,
    "apiVersion" TEXT,
    "fallbackActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "PlatformType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schedule" TEXT,
    "nextRunTime" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'ACTIVE',
    "quickLink" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "log" TEXT,
    "platformRunId" TEXT,

    CONSTRAINT "ExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourcePlatform" "PlatformType" NOT NULL,
    "targetPlatforms" "PlatformType"[],
    "scheduleExpression" TEXT NOT NULL,
    "command" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "PlatformConnection_userId_platform_idx" ON "PlatformConnection"("userId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformConnection_userId_platform_key" ON "PlatformConnection"("userId", "platform");

-- CreateIndex
CREATE INDEX "Task_userId_platform_idx" ON "Task"("userId", "platform");

-- CreateIndex
CREATE INDEX "Task_nextRunTime_idx" ON "Task"("nextRunTime");

-- CreateIndex
CREATE UNIQUE INDEX "Task_platform_externalId_key" ON "Task"("platform", "externalId");

-- CreateIndex
CREATE INDEX "ExecutionLog_taskId_triggeredAt_idx" ON "ExecutionLog"("taskId", "triggeredAt" DESC);

-- CreateIndex
CREATE INDEX "Template_isPublic_upvotes_idx" ON "Template"("isPublic", "upvotes" DESC);

-- AddForeignKey
ALTER TABLE "PlatformConnection" ADD CONSTRAINT "PlatformConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionLog" ADD CONSTRAINT "ExecutionLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

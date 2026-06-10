-- AlterEnum
ALTER TYPE "PlatformType" ADD VALUE 'MACOS_LAUNCHD';

-- CreateEnum
CREATE TYPE "ScriptType" AS ENUM ('POWERSHELL', 'BATCH', 'BASH', 'ZSH', 'PYTHON', 'NODE', 'APPLESCRIPT', 'VBSCRIPT', 'EXECUTABLE', 'HTTP', 'AI_PROMPT');

-- CreateEnum
CREATE TYPE "OsTarget" AS ENUM ('WINDOWS', 'MACOS', 'LINUX', 'CROSS_PLATFORM');

-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('BACKUP', 'CLEANUP', 'MONITORING', 'DEV_WORKFLOW', 'DATA_SYNC', 'AI_AGENT', 'NOTIFICATION', 'MEDIA', 'SYSTEM', 'OTHER');

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "scriptType" "ScriptType" NOT NULL DEFAULT 'AI_PROMPT',
ADD COLUMN     "os" "OsTarget" NOT NULL DEFAULT 'CROSS_PLATFORM',
ADD COLUMN     "category" "TemplateCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "commandTemplate" TEXT,
ADD COLUMN     "parameters" JSONB,
ADD COLUMN     "isStarter" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "icon" TEXT;

-- CreateIndex
CREATE INDEX "Template_isStarter_os_idx" ON "Template"("isStarter", "os");

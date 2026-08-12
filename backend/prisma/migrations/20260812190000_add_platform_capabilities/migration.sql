-- CreateTable
CREATE TABLE "PlatformCapability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "PlatformType" NOT NULL,
    "verb" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCapability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformCapability_userId_platform_idx" ON "PlatformCapability"("userId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCapability_userId_platform_verb_key" ON "PlatformCapability"("userId", "platform", "verb");

-- AddForeignKey
ALTER TABLE "PlatformCapability" ADD CONSTRAINT "PlatformCapability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

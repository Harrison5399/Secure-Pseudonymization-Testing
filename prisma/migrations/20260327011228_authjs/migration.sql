-- CreateTable
CREATE TABLE "public"."EncryptedBlob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bundle" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EncryptedBlob_pkey" PRIMARY KEY ("id","userId")
);

-- CreateIndex
CREATE INDEX "EncryptedBlob_userId_updatedAt_idx" ON "public"."EncryptedBlob"("userId", "updatedAt");

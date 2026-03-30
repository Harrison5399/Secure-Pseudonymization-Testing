-- CreateTable
CREATE TABLE "public"."Conversation" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EncryptedMap" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "iterations" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncryptedMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EncryptedMap_conversationId_createdAt_idx" ON "public"."EncryptedMap"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."EncryptedMap" ADD CONSTRAINT "EncryptedMap_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

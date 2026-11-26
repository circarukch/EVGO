-- CreateEnum
CREATE TYPE "PaymentBlockStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'IN_USE', 'CAPTURED', 'RELEASED', 'FAILED', 'EXPIRED', 'CAPTURE_FAILED');

-- AlterTable
ALTER TABLE "ChargingSession" ADD COLUMN     "paymentBlockId" TEXT;

-- CreateTable
CREATE TABLE "PaymentBlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "gatewayRef" TEXT,
    "purpose" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "capturedPaise" INTEGER NOT NULL DEFAULT 0,
    "status" "PaymentBlockStatus" NOT NULL DEFAULT 'PENDING',
    "meta" JSONB,
    "approveBy" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentBlock_gatewayRef_key" ON "PaymentBlock"("gatewayRef");

-- CreateIndex
CREATE INDEX "PaymentBlock_userId_status_idx" ON "PaymentBlock"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChargingSession_paymentBlockId_key" ON "ChargingSession"("paymentBlockId");

-- AddForeignKey
ALTER TABLE "ChargingSession" ADD CONSTRAINT "ChargingSession_paymentBlockId_fkey" FOREIGN KEY ("paymentBlockId") REFERENCES "PaymentBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;


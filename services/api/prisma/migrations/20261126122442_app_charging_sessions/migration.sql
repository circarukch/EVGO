-- CreateEnum
CREATE TYPE "ChargingStatus" AS ENUM ('ACTIVE', 'STOPPED');

-- AlterTable
ALTER TABLE "ChargingSession" ADD COLUMN     "costPaise" INTEGER,
ADD COLUMN     "energyWh" INTEGER,
ADD COLUMN     "maxCostPaise" INTEGER,
ADD COLUMN     "perKwhPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "ChargingStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "ChargingSession_userId_status_idx" ON "ChargingSession"("userId", "status");


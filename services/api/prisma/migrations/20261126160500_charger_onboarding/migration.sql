-- AlterTable
ALTER TABLE "Charger" ADD COLUMN     "connectedAt" TIMESTAMP(3),
ADD COLUMN     "ocppPasswordHash" TEXT,
ADD COLUMN     "online" BOOLEAN NOT NULL DEFAULT false;


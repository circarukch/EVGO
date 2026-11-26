-- CreateTable
CREATE TABLE "ChargerProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "current" TEXT NOT NULL,
    "powerKw" DECIMAL(6,1) NOT NULL,
    "connectors" TEXT[],
    "priceInr" INTEGER,
    "warrantyYears" INTEGER NOT NULL DEFAULT 1,
    "installationIncluded" BOOLEAN NOT NULL DEFAULT false,
    "suitedFor" TEXT[],
    "summary" TEXT NOT NULL,
    "specs" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargerProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargerLead" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "siteType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargerLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChargerLead_status_createdAt_idx" ON "ChargerLead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ChargerLead_userId_idx" ON "ChargerLead"("userId");

-- AddForeignKey
ALTER TABLE "ChargerLead" ADD CONSTRAINT "ChargerLead_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ChargerProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargerLead" ADD CONSTRAINT "ChargerLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


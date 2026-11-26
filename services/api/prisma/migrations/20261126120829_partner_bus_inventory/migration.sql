-- CreateTable
CREATE TABLE "PartnerBooking" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "tripRef" TEXT NOT NULL,
    "pnr" TEXT NOT NULL,
    "ticketNo" TEXT NOT NULL,
    "seatLabel" TEXT NOT NULL,
    "passengerName" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "routeName" TEXT NOT NULL,
    "departsAt" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerBooking_orderItemId_key" ON "PartnerBooking"("orderItemId");

-- CreateIndex
CREATE INDEX "PartnerBooking_providerId_pnr_idx" ON "PartnerBooking"("providerId", "pnr");

-- AddForeignKey
ALTER TABLE "PartnerBooking" ADD CONSTRAINT "PartnerBooking_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "citizenId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "transactionId" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "refundId" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_transactionId_key" ON "payments"("transactionId");

-- CreateIndex
CREATE INDEX "payments_complaintId_status_idx" ON "payments"("complaintId", "status");

-- CreateIndex
CREATE INDEX "payments_citizenId_status_idx" ON "payments"("citizenId", "status");

-- CreateIndex
CREATE INDEX "payments_paymentIntentId_idx" ON "payments"("paymentIntentId");

-- CreateIndex
CREATE INDEX "payments_createdAt_idx" ON "payments"("createdAt");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_citizenId_fkey" FOREIGN KEY ("citizenId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount" > 0);

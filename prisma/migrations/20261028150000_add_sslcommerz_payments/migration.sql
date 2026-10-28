-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'BKASH', 'NAGAD');

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'SSLCOMMERZ';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "bankTransactionId" TEXT,
ADD COLUMN     "chargedAmount" DECIMAL(12,2),
ADD COLUMN     "chargedCurrency" TEXT,
ADD COLUMN     "method" "PaymentMethod" NOT NULL DEFAULT 'CARD',
ADD COLUMN     "validationId" TEXT;

-- CreateIndex
CREATE INDEX "payments_provider_status_createdAt_idx" ON "payments"("provider", "status", "createdAt");


-- AddCheckConstraint
ALTER TABLE "payments" ADD CONSTRAINT "payments_charged_amount_check" CHECK ("chargedAmount" IS NULL OR "chargedAmount" > 0);

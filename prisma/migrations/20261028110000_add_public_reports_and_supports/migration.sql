-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REPORT_SUPPORTED';

-- AlterTable
ALTER TABLE "complaints" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "complaint_supports" (
    "complaintId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_supports_pkey" PRIMARY KEY ("complaintId","userId")
);

-- CreateIndex
CREATE INDEX "complaint_supports_userId_idx" ON "complaint_supports"("userId");

-- CreateIndex
CREATE INDEX "complaints_isPublic_status_idx" ON "complaints"("isPublic", "status");

-- CreateIndex
CREATE INDEX "complaints_latitude_longitude_idx" ON "complaints"("latitude", "longitude");

-- AddForeignKey
ALTER TABLE "complaint_supports" ADD CONSTRAINT "complaint_supports_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_supports" ADD CONSTRAINT "complaint_supports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


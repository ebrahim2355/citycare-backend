-- CreateTable
CREATE TABLE "feedbacks" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "citizenId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feedbacks_complaintId_key" ON "feedbacks"("complaintId");

-- CreateIndex
CREATE INDEX "feedbacks_citizenId_idx" ON "feedbacks"("citizenId");

-- CreateIndex
CREATE INDEX "feedbacks_rating_idx" ON "feedbacks"("rating");

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_citizenId_fkey" FOREIGN KEY ("citizenId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_rating_check" CHECK ("rating" BETWEEN 1 AND 5);

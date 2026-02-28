-- CreateTable
CREATE TABLE "user_feedback_limits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gestorId" TEXT NOT NULL,
    "maxFeedbacksPerDay" INTEGER,
    "maxFeedbacksPerWeek" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),

    CONSTRAINT "user_feedback_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_feedback_limits_userId_key" ON "user_feedback_limits"("userId");

-- AddForeignKey
ALTER TABLE "user_feedback_limits" ADD CONSTRAINT "user_feedback_limits_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_feedback_limits" ADD CONSTRAINT "user_feedback_limits_gestorId_fkey"
  FOREIGN KEY ("gestorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

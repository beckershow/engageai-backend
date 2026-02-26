-- Add new fields to feedbacks table
ALTER TABLE "feedbacks" ADD COLUMN "viewedAt" TIMESTAMP(3);
ALTER TABLE "feedbacks" ADD COLUMN "isShared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "feedbacks" ADD COLUMN "sharedPostId" TEXT;

-- Add weekly limit to feedback_settings
ALTER TABLE "feedback_settings" ADD COLUMN "maxFeedbacksPerWeek" INTEGER NOT NULL DEFAULT 20;

-- Create FeedbackRequestStatus enum
CREATE TYPE "FeedbackRequestStatus" AS ENUM ('pending', 'fulfilled', 'declined');

-- Create feedback_requests table
CREATE TABLE "feedback_requests" (
  "id" TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "topic" TEXT,
  "message" TEXT,
  "status" "FeedbackRequestStatus" NOT NULL DEFAULT 'pending',
  "feedbackId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedback_requests_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one fulfilled feedback per request
ALTER TABLE "feedback_requests" ADD CONSTRAINT "feedback_requests_feedbackId_key" UNIQUE ("feedbackId");

-- Foreign keys for feedback_requests
ALTER TABLE "feedback_requests" ADD CONSTRAINT "feedback_requests_fromUserId_fkey"
  FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_requests" ADD CONSTRAINT "feedback_requests_toUserId_fkey"
  FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_requests" ADD CONSTRAINT "feedback_requests_feedbackId_fkey"
  FOREIGN KEY ("feedbackId") REFERENCES "feedbacks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New NotificationType values
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'feedback_request_received';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'feedback_rejected';

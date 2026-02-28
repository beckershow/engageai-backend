-- Add new NotificationType enum values for full feedback notification flow
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'feedback_pending_approval';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'feedback_request_declined';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'feedback_request_fulfilled';

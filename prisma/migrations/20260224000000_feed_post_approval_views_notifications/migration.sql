-- Migration: feed_post_approval_views_notifications
-- Adds approval workflow, video support, view tracking and new notification types
-- to the feed_posts table
-- Note: each statement is idempotent to allow safe re-application

-- 1. Create FeedPostStatus enum (idempotent via DO block)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FeedPostStatus') THEN
    CREATE TYPE "FeedPostStatus" AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

-- 2. Add new columns to feed_posts (idempotent via IF NOT EXISTS)
ALTER TABLE "feed_posts" ADD COLUMN IF NOT EXISTS "videoUrl"       TEXT;
ALTER TABLE "feed_posts" ADD COLUMN IF NOT EXISTS "status"         "FeedPostStatus" NOT NULL DEFAULT 'pending';
ALTER TABLE "feed_posts" ADD COLUMN IF NOT EXISTS "approvedAt"     TIMESTAMP(3);
ALTER TABLE "feed_posts" ADD COLUMN IF NOT EXISTS "approvedById"   TEXT;
ALTER TABLE "feed_posts" ADD COLUMN IF NOT EXISTS "rejectedReason" TEXT;
ALTER TABLE "feed_posts" ADD COLUMN IF NOT EXISTS "viewsCount"     INTEGER NOT NULL DEFAULT 0;

-- 3. Retroactively approve all existing posts so the feed keeps working
UPDATE "feed_posts" SET "status" = 'approved' WHERE "deletedAt" IS NULL AND "status" = 'pending';

-- 4. Create feed_post_views table (idempotent)
CREATE TABLE IF NOT EXISTS "feed_post_views" (
  "id"       TEXT NOT NULL,
  "postId"   TEXT NOT NULL,
  "userId"   TEXT NOT NULL,
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "feed_post_views_pkey" PRIMARY KEY ("id")
);

-- 5. Unique constraint: one view record per (post, user)
CREATE UNIQUE INDEX IF NOT EXISTS "feed_post_views_postId_userId_key"
  ON "feed_post_views"("postId", "userId");

-- 6. Foreign keys for feed_post_views (idempotent via DO block)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feed_post_views_postId_fkey'
  ) THEN
    ALTER TABLE "feed_post_views"
      ADD CONSTRAINT "feed_post_views_postId_fkey"
        FOREIGN KEY ("postId") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feed_post_views_userId_fkey'
  ) THEN
    ALTER TABLE "feed_post_views"
      ADD CONSTRAINT "feed_post_views_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 7. Add new values to NotificationType enum (each ADD VALUE is its own statement)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'post_pending_approval';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'post_approved';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'post_rejected';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'post_liked';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'post_commented';

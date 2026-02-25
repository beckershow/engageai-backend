-- Migration: fix_schema_drift
-- Fixes: missing summaryAudioKey on trainings, stale costCurrency on store_items,
--        FK constraint naming and index rename from prior manual migrations.

-- 1. trainings: add summaryAudioKey (already exists in DB, IF NOT EXISTS is idempotent)
ALTER TABLE "trainings" ADD COLUMN IF NOT EXISTS "summaryAudioKey" TEXT;

-- 2. store_items: drop costCurrency (was supposed to be dropped by prior migration)
ALTER TABLE "store_items" DROP COLUMN IF EXISTS "costCurrency";

-- 3. Fix FK constraint names on store_audit_logs
--    (manual migration used lowercase names; Prisma expects camelCase)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_audit_logs_itemid_fkey') THEN
    ALTER TABLE "store_audit_logs" DROP CONSTRAINT "store_audit_logs_itemid_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_audit_logs_performedbyid_fkey') THEN
    ALTER TABLE "store_audit_logs" DROP CONSTRAINT "store_audit_logs_performedbyid_fkey";
  END IF;
END $$;

ALTER TABLE "store_audit_logs"
  ADD CONSTRAINT "store_audit_logs_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "store_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "store_audit_logs"
  ADD CONSTRAINT "store_audit_logs_performedById_fkey"
    FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Fix FK constraint names on store_manager_inventory
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_manager_inventory_itemid_fkey') THEN
    ALTER TABLE "store_manager_inventory" DROP CONSTRAINT "store_manager_inventory_itemid_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_manager_inventory_managerid_fkey') THEN
    ALTER TABLE "store_manager_inventory" DROP CONSTRAINT "store_manager_inventory_managerid_fkey";
  END IF;
END $$;

ALTER TABLE "store_manager_inventory"
  ADD CONSTRAINT "store_manager_inventory_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "store_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_manager_inventory"
  ADD CONSTRAINT "store_manager_inventory_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Fix FK constraint names on store_reward_requests + drop updatedAt default
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_reward_requests_managerid_fkey') THEN
    ALTER TABLE "store_reward_requests" DROP CONSTRAINT "store_reward_requests_managerid_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_reward_requests_reviewedbyid_fkey') THEN
    ALTER TABLE "store_reward_requests" DROP CONSTRAINT "store_reward_requests_reviewedbyid_fkey";
  END IF;
END $$;

ALTER TABLE "store_reward_requests"
  ADD CONSTRAINT "store_reward_requests_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "store_reward_requests"
  ADD CONSTRAINT "store_reward_requests_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "store_reward_requests" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- 6. Rename unique index on store_manager_inventory to Prisma convention
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'store_manager_inventory_item_manager_unique') THEN
    ALTER INDEX "store_manager_inventory_item_manager_unique"
      RENAME TO "store_manager_inventory_itemId_managerId_key";
  END IF;
END $$;

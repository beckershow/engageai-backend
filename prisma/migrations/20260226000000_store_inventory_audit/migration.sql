-- Migration: store_inventory_audit
-- Removes costCurrency, adds StoreManagerInventory, StoreRewardRequest, StoreAuditLog
-- and 5 new NotificationType values + 2 new enums

-- 1. Remove costCurrency column from store_items
ALTER TABLE store_items DROP COLUMN IF EXISTS cost_currency;

-- 2. Add new NotificationType values
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'store_item_sent_to_manager';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'store_manager_item_activated';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'store_manager_item_deactivated';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'store_reward_requested';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'store_reward_request_reviewed';

-- 3. Create new enums
DO $$ BEGIN
  CREATE TYPE "StoreManagerInventoryStatus" AS ENUM ('in_stock', 'active_for_team', 'inactive_for_team');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "StoreRewardRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'converted');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 4. Create store_manager_inventory
CREATE TABLE IF NOT EXISTS store_manager_inventory (
  id TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "managerId" TEXT NOT NULL,
  status "StoreManagerInventoryStatus" NOT NULL DEFAULT 'in_stock',
  "activatedAt" TIMESTAMP(3),
  CONSTRAINT store_manager_inventory_pkey PRIMARY KEY (id),
  CONSTRAINT store_manager_inventory_item_manager_unique UNIQUE ("itemId", "managerId"),
  CONSTRAINT store_manager_inventory_itemId_fkey FOREIGN KEY ("itemId") REFERENCES store_items(id) ON DELETE CASCADE,
  CONSTRAINT store_manager_inventory_managerId_fkey FOREIGN KEY ("managerId") REFERENCES users(id) ON DELETE CASCADE
);

-- 5. Create store_reward_requests
CREATE TABLE IF NOT EXISTS store_reward_requests (
  id TEXT NOT NULL,
  "managerId" TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  "estimatedStarCost" INTEGER NOT NULL DEFAULT 0,
  justification TEXT NOT NULL,
  status "StoreRewardRequestStatus" NOT NULL DEFAULT 'pending',
  "reviewNote" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "convertedItemId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT store_reward_requests_pkey PRIMARY KEY (id),
  CONSTRAINT store_reward_requests_managerId_fkey FOREIGN KEY ("managerId") REFERENCES users(id),
  CONSTRAINT store_reward_requests_reviewedById_fkey FOREIGN KEY ("reviewedById") REFERENCES users(id)
);

-- 6. Create store_audit_logs
CREATE TABLE IF NOT EXISTS store_audit_logs (
  id TEXT NOT NULL,
  "itemId" TEXT,
  action TEXT NOT NULL,
  "performedById" TEXT NOT NULL,
  metadata JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT store_audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT store_audit_logs_itemId_fkey FOREIGN KEY ("itemId") REFERENCES store_items(id) ON DELETE SET NULL,
  CONSTRAINT store_audit_logs_performedById_fkey FOREIGN KEY ("performedById") REFERENCES users(id)
);

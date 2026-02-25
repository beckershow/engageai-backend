-- AlterEnum: NotificationType — adicionar tipos de loja
ALTER TYPE "NotificationType" ADD VALUE 'store_item_created';
ALTER TYPE "NotificationType" ADD VALUE 'store_item_activated';
ALTER TYPE "NotificationType" ADD VALUE 'store_item_available_to_manager';
ALTER TYPE "NotificationType" ADD VALUE 'store_item_available_to_team';

-- CreateEnum: StoreItemStatus
CREATE TYPE "StoreItemStatus" AS ENUM ('draft', 'created', 'active', 'inactive');

-- CreateEnum: StoreTeamScope
CREATE TYPE "StoreTeamScope" AS ENUM ('all', 'specific');

-- CreateTable: store_item_categories
CREATE TABLE "store_item_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "store_item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_item_categories_name_key" ON "store_item_categories"("name");

-- CreateTable: store_items
CREATE TABLE "store_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "costCurrency" INTEGER NOT NULL DEFAULT 0,
    "costStars" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER,
    "imageUrl" TEXT,
    "internalNotes" TEXT,
    "status" "StoreItemStatus" NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: store_item_manager_visibility
CREATE TABLE "store_item_manager_visibility" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    CONSTRAINT "store_item_manager_visibility_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_item_manager_visibility_itemId_managerId_key" ON "store_item_manager_visibility"("itemId", "managerId");

-- CreateTable: store_item_team_visibility
CREATE TABLE "store_item_team_visibility" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "userId" TEXT,
    "teamScope" "StoreTeamScope" NOT NULL DEFAULT 'all',
    CONSTRAINT "store_item_team_visibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable: store_redemptions
CREATE TABLE "store_redemptions" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_redemptions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: store_items → store_item_categories
ALTER TABLE "store_items" ADD CONSTRAINT "store_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "store_item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: store_items → users (createdBy)
ALTER TABLE "store_items" ADD CONSTRAINT "store_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: store_item_manager_visibility → store_items
ALTER TABLE "store_item_manager_visibility" ADD CONSTRAINT "store_item_manager_visibility_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "store_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: store_item_manager_visibility → users (manager)
ALTER TABLE "store_item_manager_visibility" ADD CONSTRAINT "store_item_manager_visibility_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: store_item_team_visibility → store_items
ALTER TABLE "store_item_team_visibility" ADD CONSTRAINT "store_item_team_visibility_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "store_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: store_item_team_visibility → users (manager)
ALTER TABLE "store_item_team_visibility" ADD CONSTRAINT "store_item_team_visibility_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: store_item_team_visibility → users (user, nullable)
ALTER TABLE "store_item_team_visibility" ADD CONSTRAINT "store_item_team_visibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: store_redemptions → store_items
ALTER TABLE "store_redemptions" ADD CONSTRAINT "store_redemptions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "store_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: store_redemptions → users
ALTER TABLE "store_redemptions" ADD CONSTRAINT "store_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

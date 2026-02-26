-- AlterTable: store_items — múltiplos resgates por colaborador
ALTER TABLE "store_items" ADD COLUMN "allowMultipleRedemptions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "store_items" ADD COLUMN "maxRedemptionsPerUser" INTEGER;

-- AlterTable: store_reward_requests — imagem da solicitação
ALTER TABLE "store_reward_requests" ADD COLUMN "imageUrl" TEXT;

-- AlterEnum: StoreRewardRequestStatus — novos status
ALTER TYPE "StoreRewardRequestStatus" ADD VALUE IF NOT EXISTS 'refused';
ALTER TYPE "StoreRewardRequestStatus" ADD VALUE IF NOT EXISTS 'proceeded';

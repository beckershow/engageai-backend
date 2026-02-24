-- CreateTable
CREATE TABLE "gestor_feed_configs" (
    "id" TEXT NOT NULL,
    "gestorId" TEXT NOT NULL,
    "requireApproval" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gestor_feed_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gestor_feed_configs_gestorId_key" ON "gestor_feed_configs"("gestorId");

-- AddForeignKey
ALTER TABLE "gestor_feed_configs" ADD CONSTRAINT "gestor_feed_configs_gestorId_fkey" FOREIGN KEY ("gestorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

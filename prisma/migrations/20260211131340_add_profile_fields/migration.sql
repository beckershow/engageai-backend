-- AlterTable
ALTER TABLE "users" ADD COLUMN     "hiredAt" TIMESTAMP(3),
ADD COLUMN     "localizacao" TEXT,
ADD COLUMN     "telefone" TEXT;

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "humor" BOOLEAN NOT NULL DEFAULT true,
    "pesquisas" BOOLEAN NOT NULL DEFAULT true,
    "recompensas" BOOLEAN NOT NULL DEFAULT true,
    "treinamentos" BOOLEAN NOT NULL DEFAULT false,
    "feedbacks" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_key" ON "notification_preferences"("userId");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

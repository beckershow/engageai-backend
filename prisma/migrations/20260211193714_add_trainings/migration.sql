-- CreateEnum
CREATE TYPE "TrainingContentOrigin" AS ENUM ('texto', 'documento', 'audio', 'video');

-- CreateEnum
CREATE TYPE "TrainingContentFormat" AS ENUM ('texto', 'audio', 'video');

-- CreateEnum
CREATE TYPE "TrainingQuestionType" AS ENUM ('multipla_escolha', 'descritiva');

-- CreateEnum
CREATE TYPE "TrainingAnswerType" AS ENUM ('multipla_escolha', 'descritiva', 'checkbox', 'audio', 'video');

-- CreateEnum
CREATE TYPE "TrainingCoverType" AS ENUM ('upload', 'url');

-- CreateTable
CREATE TABLE "trainings" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverType" "TrainingCoverType" NOT NULL DEFAULT 'url',
    "coverUrl" TEXT,
    "primaryColor" TEXT,
    "campaignId" TEXT,
    "contentOrigin" "TrainingContentOrigin",
    "contentText" TEXT,
    "contentFiles" TEXT[],
    "noAssessment" BOOLEAN NOT NULL DEFAULT false,
    "convertContent" BOOLEAN NOT NULL DEFAULT false,
    "conversionType" "TrainingContentFormat",
    "allowOriginal" BOOLEAN NOT NULL DEFAULT false,
    "summaryPercent" INTEGER NOT NULL DEFAULT 0,
    "summaryText" TEXT,
    "summaryConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "aiConfig" JSONB,
    "aiConversions" "TrainingContentFormat"[],
    "visibleFormats" "TrainingContentFormat"[],
    "questionsRequired" BOOLEAN NOT NULL DEFAULT true,
    "requireSequential" BOOLEAN NOT NULL DEFAULT false,
    "audienceType" "PublicoAlvoType" NOT NULL DEFAULT 'todo_time',
    "audienceIds" TEXT[],
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "rewardsActive" BOOLEAN NOT NULL DEFAULT true,
    "rewardXP" INTEGER NOT NULL DEFAULT 0,
    "rewardStars" INTEGER NOT NULL DEFAULT 0,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_questions" (
    "id" TEXT NOT NULL,
    "trainingId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "type" "TrainingQuestionType" NOT NULL,
    "answerTypes" "TrainingAnswerType"[],
    "options" TEXT[],
    "correctOption" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "training_questions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "trainings" ADD CONSTRAINT "trainings_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_questions" ADD CONSTRAINT "training_questions_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "trainings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

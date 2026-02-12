-- AlterTable
ALTER TABLE "training_progress" ADD COLUMN     "score" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "training_question_progress" (
    "id" TEXT NOT NULL,
    "trainingId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_question_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "training_question_progress_questionId_userId_key" ON "training_question_progress"("questionId", "userId");

-- AddForeignKey
ALTER TABLE "training_question_progress" ADD CONSTRAINT "training_question_progress_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "trainings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_question_progress" ADD CONSTRAINT "training_question_progress_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "training_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_question_progress" ADD CONSTRAINT "training_question_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: GestorFeedbackConfig — limites por time e individual
ALTER TABLE "gestor_feedback_configs" ADD COLUMN "limitsEnabled"           BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "gestor_feedback_configs" ADD COLUMN "maxFeedbacksPerDay"      INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "gestor_feedback_configs" ADD COLUMN "maxFeedbacksPerWeek"     INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "gestor_feedback_configs" ADD COLUMN "individualLimitsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: FeedbackSettings — controle global de limite individual
ALTER TABLE "feedback_settings" ADD COLUMN "individualLimitsEnabled" BOOLEAN NOT NULL DEFAULT false;

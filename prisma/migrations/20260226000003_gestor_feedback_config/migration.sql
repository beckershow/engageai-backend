-- Create per-gestor feedback configuration table
CREATE TABLE "gestor_feedback_configs" (
  "id" TEXT NOT NULL,
  "gestorId" TEXT NOT NULL,
  "allowAnyUser" BOOLEAN NOT NULL DEFAULT true,
  "allowPublicFeedback" BOOLEAN NOT NULL DEFAULT true,
  "requireApproval" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gestor_feedback_configs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "gestor_feedback_configs"
  ADD CONSTRAINT "gestor_feedback_configs_gestorId_key" UNIQUE ("gestorId");

ALTER TABLE "gestor_feedback_configs"
  ADD CONSTRAINT "gestor_feedback_configs_gestorId_fkey"
  FOREIGN KEY ("gestorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

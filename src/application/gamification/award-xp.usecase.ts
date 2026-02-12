import { enqueueGamificationEvent } from '../../infrastructure/queue/bullmq.client.js'
import type { UserRole } from '@prisma/client'

export interface AwardXpInput {
  userId: string
  userRole: UserRole
  action: string
  xp: number
  stars?: number
  context?: Record<string, unknown>
}

/**
 * Award XP to a user via async queue.
 * Respects GamificationGuard - only colaboradores receive XP.
 * HTTP response is immediate; XP is processed asynchronously.
 */
export async function awardXpUseCase(input: AwardXpInput): Promise<void> {
  if (input.userRole !== 'colaborador') {
    return // GamificationGuard: only colaboradores get XP
  }

  await enqueueGamificationEvent({
    userId: input.userId,
    action: input.action,
    xp: input.xp,
    stars: input.stars ?? 0,
    context: input.context,
  })
}

// XP reward table (matches frontend gamification config)
export const XP_REWARDS = {
  acessar_plataforma: 10,
  registrar_humor: 20,
  criar_post: 30,
  comentar_post: 10,
  reagir_post: 5,
  dar_feedback: 50,
  responder_pesquisa: 40,
  completar_treinamento: 100,
  participar_evento: 80,
  completar_missao: 50,
} as const

export const STAR_REWARDS = {
  acessar_plataforma: 0,
  registrar_humor: 0,
  criar_post: 1,
  comentar_post: 0,
  reagir_post: 0,
  dar_feedback: 2,
  responder_pesquisa: 2,
  completar_treinamento: 5,
  participar_evento: 3,
  completar_missao: 1,
} as const

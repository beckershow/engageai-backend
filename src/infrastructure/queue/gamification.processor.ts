import { Worker, type Job } from 'bullmq'
import { prisma } from '../database/prisma.client.js'
import { updateLeaderboardScore } from '../cache/redis.client.js'
import { checkLevelUp, calculateXpForNextLevel } from '../../shared/utils/level-calculator.js'
import { queueConnection, GAMIFICATION_QUEUE, type GamificationJobData, enqueueNotification } from './bullmq.client.js'

async function processGamificationJob(job: Job<GamificationJobData>): Promise<void> {
  const { userId, action, xp = 0, stars = 0, context } = job.data

  console.log(`[Gamification] Processing job: userId=${userId} action=${action} xp=${xp} stars=${stars}`)

  // Get user and check GamificationGuard
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    console.warn(`[Gamification] User ${userId} not found`)
    return
  }

  if (user.role !== 'colaborador') {
    console.log(`[Gamification] Blocked: user ${userId} has role ${user.role}`)
    return
  }

  const oldXp = user.xp
  const newXp = user.xp + xp
  const newStars = user.estrelas + stars

  const levelCheck = checkLevelUp(oldXp, newXp)
  const newLevel = levelCheck.newLevel
  const newXpProximo = calculateXpForNextLevel(newLevel)

  // Update user
  await prisma.user.update({
    where: { id: userId },
    data: {
      xp: newXp,
      estrelas: newStars,
      nivel: newLevel,
      xpProximo: newXpProximo,
    },
  })

  // Update Redis leaderboard
  await updateLeaderboardScore(userId, newXp)

  // Create notification for XP
  if (xp > 0) {
    await enqueueNotification({
      userId,
      type: 'xp_gained',
      title: 'XP conquistado!',
      message: `Você ganhou ${xp} XP por ${formatAction(action)}`,
      data: { xp, action, context },
    })
  }

  // Create notification for level up
  if (levelCheck.leveledUp) {
    await enqueueNotification({
      userId,
      type: 'level_up',
      title: `Subiu para Nível ${newLevel}!`,
      message: `Parabéns! Você alcançou o nível ${newLevel}!`,
      data: { oldLevel: levelCheck.oldLevel, newLevel },
    })
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: `gamification.${action}`,
      resourceType: 'user',
      resourceId: userId,
      metadata: { xp, stars, newTotal: newXp, leveledUp: levelCheck.leveledUp },
    },
  })
}

function formatAction(action: string): string {
  const map: Record<string, string> = {
    acessar_plataforma: 'acessar a plataforma',
    completar_treinamento: 'completar um treinamento',
    interagir_feed: 'interagir no feed',
    dar_feedback: 'enviar feedback',
    responder_pesquisa: 'responder pesquisa',
    participar_evento: 'participar de evento',
    registrar_humor: 'registrar humor',
    criar_post: 'criar post',
    comentar_post: 'comentar em post',
    reagir_post: 'reagir a post',
    resgatar_recompensa: 'resgatar recompensa',
  }
  return map[action] ?? action
}

export function createGamificationWorker(): Worker {
  return new Worker<GamificationJobData>(
    GAMIFICATION_QUEUE,
    processGamificationJob,
    {
      connection: queueConnection,
      concurrency: 5,
    },
  )
}

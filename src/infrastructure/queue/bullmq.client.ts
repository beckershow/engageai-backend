import { Queue, Worker, type Job } from 'bullmq'
import { env } from '../../config/env.js'
import { prisma } from '../database/prisma.client.js'

const redisUrl = new URL(env.REDIS_URL)
const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
}

// Queue names
export const GAMIFICATION_QUEUE = 'gamification'
export const NOTIFICATION_QUEUE = 'notifications'

// Gamification queue
export const gamificationQueue = new Queue(GAMIFICATION_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
})

// Notification queue
export const notificationQueue = new Queue(NOTIFICATION_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 2000 },
    removeOnComplete: 50,
    removeOnFail: 20,
  },
})

export interface GamificationJobData {
  userId: string
  action: string
  xp?: number
  stars?: number
  context?: Record<string, unknown>
}

export interface NotificationJobData {
  userId: string
  type: string
  title: string
  message: string
  data?: Record<string, unknown>
}

export async function enqueueGamificationEvent(data: GamificationJobData): Promise<void> {
  try {
    await gamificationQueue.add('award-xp', data)
  } catch (err) {
    // Redis unavailable - log warning but don't block HTTP response
    console.warn('[Gamification] Queue unavailable, XP event dropped:', (err as Error).message)
  }
}

export async function enqueueNotification(data: NotificationJobData): Promise<void> {
  // Salva diretamente no banco — não depende do Redis/BullMQ estar disponível
  await prisma.notification.create({
    data: {
      userId: data.userId,
      type: data.type as any,
      title: data.title,
      message: data.message,
      data: data.data ? JSON.parse(JSON.stringify(data.data)) : undefined,
    },
  })

  // Tenta enfileirar para processamento assíncrono adicional (ex: e-mail/push no futuro)
  notificationQueue.add('send-notification', data).catch(() => {
    // Redis indisponível — silencioso, notificação já está no banco
  })
}

export { Worker, type Job }
export { connection as queueConnection }

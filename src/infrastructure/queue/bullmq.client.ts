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

// BullMQ Queues Disabled (Redis Required)
/*
export const gamificationQueue = new Queue(...)
export const notificationQueue = new Queue(...)
*/

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
  // BullMQ disabled - no-op
  console.log('[Gamification] Queue disabled, XP event skipped')
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

  // BullMQ disabled - no-op for async processing
  console.log('[Notification] Notification saved to DB, async processing skipped')
}

export { Worker, type Job }
export const queueConnection = connection

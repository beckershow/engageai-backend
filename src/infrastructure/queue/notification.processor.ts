import { Worker, type Job } from 'bullmq'
import { prisma } from '../database/prisma.client.js'
import { queueConnection, NOTIFICATION_QUEUE, type NotificationJobData } from './bullmq.client.js'

async function processNotificationJob(job: Job<NotificationJobData>): Promise<void> {
  // A notificação já foi salva no banco diretamente por enqueueNotification.
  // Este worker existe apenas para side-effects futuros (e-mail, push, etc.).
  const { userId, title } = job.data
  console.log(`[NotificationWorker] Side-effects processed for user ${userId}: ${title}`)
}

export function createNotificationWorker(): Worker {
  return new Worker<NotificationJobData>(
    NOTIFICATION_QUEUE,
    processNotificationJob,
    {
      connection: queueConnection,
      concurrency: 10,
    },
  )
}

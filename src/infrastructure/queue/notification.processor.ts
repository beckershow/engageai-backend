import { Worker, type Job } from 'bullmq'
import { prisma } from '../database/prisma.client.js'
import { queueConnection, NOTIFICATION_QUEUE, type NotificationJobData } from './bullmq.client.js'

async function processNotificationJob(job: Job<NotificationJobData>): Promise<void> {
  const { userId, type, title, message, data } = job.data

  await prisma.notification.create({
    data: {
      userId,
      type: type as any,
      title,
      message,
      data: data ? JSON.parse(JSON.stringify(data)) : undefined,
    },
  })

  console.log(`[Notification] Created for user ${userId}: ${title}`)
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

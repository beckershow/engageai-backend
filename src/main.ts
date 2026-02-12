import 'dotenv/config'
import Fastify from 'fastify'
import { env } from './config/env.js'
import corsPlugin from './presentation/plugins/cors.plugin.js'
import { jwtPlugin } from './presentation/plugins/jwt.plugin.js'
import { rateLimitPlugin } from './presentation/plugins/rate-limit.plugin.js'
import { swaggerPlugin } from './presentation/plugins/swagger.plugin.js'
import multipart from '@fastify/multipart'
import { authRoutes } from './presentation/routes/v1/auth.routes.js'
import { usersRoutes } from './presentation/routes/v1/users.routes.js'
import { moodRoutes } from './presentation/routes/v1/mood.routes.js'
import { feedRoutes } from './presentation/routes/v1/feed.routes.js'
import { feedbacksRoutes } from './presentation/routes/v1/feedbacks.routes.js'
import { surveysRoutes } from './presentation/routes/v1/surveys.routes.js'
import { coursesRoutes } from './presentation/routes/v1/courses.routes.js'
import { trainingsRoutes } from './presentation/routes/v1/trainings.routes.js'
import { eventsRoutes } from './presentation/routes/v1/events.routes.js'
import { engagementsRoutes } from './presentation/routes/v1/engagements.routes.js'
import { goalsRoutes } from './presentation/routes/v1/goals.routes.js'
import { rewardsRoutes } from './presentation/routes/v1/rewards.routes.js'
import { dailyMissionsRoutes } from './presentation/routes/v1/daily-missions.routes.js'
import { rankingRoutes } from './presentation/routes/v1/ranking.routes.js'
import { analyticsRoutes } from './presentation/routes/v1/analytics.routes.js'
import { notificationsRoutes } from './presentation/routes/v1/notifications.routes.js'
import { aiRoutes } from './presentation/routes/v1/ai.routes.js'
import { uploadsRoutes } from './presentation/routes/v1/uploads.routes.js'
import { AppError } from './shared/errors/app-error.js'
import { createGamificationWorker } from './infrastructure/queue/gamification.processor.js'
import { createNotificationWorker } from './infrastructure/queue/notification.processor.js'

async function build() {
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  })

  // Global error handler
  fastify.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code ?? 'ERROR',
          message: error.message,
          statusCode: error.statusCode,
        },
      })
    }

    // Zod validation error
    if (error.name === 'ZodError') {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: JSON.parse(error.message),
          statusCode: 422,
        },
      })
    }

    // Fastify validation error
    if (error.statusCode === 400) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: error.message,
          statusCode: 400,
        },
      })
    }

    fastify.log.error(error)
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        statusCode: 500,
      },
    })
  })

  // Plugins
  await fastify.register(corsPlugin)
  await fastify.register(jwtPlugin)
  await fastify.register(rateLimitPlugin)
  await fastify.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024,
    },
  })

  if (env.NODE_ENV !== 'test') {
    await fastify.register(swaggerPlugin)
  }

  // Health check
  fastify.get('/health', { schema: { hide: true } }, async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  }))

  // API v1 routes
  const V1_PREFIX = '/api/v1'

  await fastify.register(authRoutes, { prefix: `${V1_PREFIX}/auth` })
  await fastify.register(usersRoutes, { prefix: `${V1_PREFIX}/users` })
  await fastify.register(moodRoutes, { prefix: `${V1_PREFIX}/mood` })
  await fastify.register(feedRoutes, { prefix: `${V1_PREFIX}/feed` })
  await fastify.register(feedbacksRoutes, { prefix: `${V1_PREFIX}/feedbacks` })
  await fastify.register(surveysRoutes, { prefix: `${V1_PREFIX}/surveys` })
  await fastify.register(coursesRoutes, { prefix: `${V1_PREFIX}/courses` })
  await fastify.register(trainingsRoutes, { prefix: `${V1_PREFIX}/trainings` })
  await fastify.register(eventsRoutes, { prefix: `${V1_PREFIX}/events` })
  await fastify.register(engagementsRoutes, { prefix: `${V1_PREFIX}/engagements` })
  await fastify.register(goalsRoutes, { prefix: `${V1_PREFIX}/goals` })
  await fastify.register(rewardsRoutes, { prefix: `${V1_PREFIX}/rewards` })
  await fastify.register(dailyMissionsRoutes, { prefix: `${V1_PREFIX}/daily-missions` })
  await fastify.register(rankingRoutes, { prefix: `${V1_PREFIX}/ranking` })
  await fastify.register(analyticsRoutes, { prefix: `${V1_PREFIX}/analytics` })
  await fastify.register(notificationsRoutes, { prefix: `${V1_PREFIX}/notifications` })
  await fastify.register(aiRoutes, { prefix: `${V1_PREFIX}/ai` })
  await fastify.register(uploadsRoutes, { prefix: `${V1_PREFIX}/uploads` })

  return fastify
}

async function main() {
  const fastify = await build()

  // Start BullMQ workers (only in non-test env)
  if (env.NODE_ENV !== 'test') {
    const gamificationWorker = createGamificationWorker()
    const notificationWorker = createNotificationWorker()

    gamificationWorker.on('completed', (job) => {
      fastify.log.info(`[GamificationWorker] Job ${job.id} completed`)
    })
    gamificationWorker.on('failed', (job, err) => {
      fastify.log.error(`[GamificationWorker] Job ${job?.id} failed: ${err.message}`)
    })
    notificationWorker.on('failed', (job, err) => {
      fastify.log.error(`[NotificationWorker] Job ${job?.id} failed: ${err.message}`)
    })
  }

  try {
    await fastify.listen({ port: env.PORT, host: '0.0.0.0' })
    console.log(`
🚀 EngageAI Backend running at http://localhost:${env.PORT}
📚 Swagger UI: http://localhost:${env.PORT}/docs
🏥 Health: http://localhost:${env.PORT}/health
    `)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

main()

export { build }

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
    bodyLimit: 5 * 1024 * 1024, // 5MB to accommodate large JSON payloads
  })

  // Global error handler
  fastify.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _request, reply) => {
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
      let details: any[] = []
      try { details = JSON.parse(error.message) } catch { /* ignore */ }
      const fieldMessages = details
        .map((d: any) => {
          const field = d.path?.join('.') || 'campo'
          if (d.code === 'invalid_type') return `"${field}" esperava ${d.expected}, recebeu ${d.received}`
          if (d.code === 'too_small') return `"${field}" é obrigatório`
          if (d.code === 'invalid_enum_value') return `"${field}" valor inválido: ${d.received}`
          return d.message ? `"${field}": ${d.message}` : `"${field}" inválido`
        })
        .slice(0, 5)
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: fieldMessages.length
            ? `Erro de validação: ${fieldMessages.join('; ')}`
            : 'Erro de validação nos dados enviados',
          details,
          statusCode: 422,
        },
      })
    }

    // Fastify body too large
    if (error.statusCode === 413 || error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'O conteúdo enviado excede o tamanho máximo permitido. Reduza o tamanho dos arquivos ou imagens.',
          statusCode: 413,
        },
      })
    }

    // Fastify validation / bad request
    if (error.statusCode === 400) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: error.message,
          statusCode: 400,
        },
      })
    }

    // Prisma errors
    if (error.name === 'PrismaClientKnownRequestError' || (error as any).clientVersion) {
      const prismaError = error as any
      fastify.log.error(error)

      if (prismaError.code === 'P2002') {
        const fields = prismaError.meta?.target?.join(', ') || 'campo'
        return reply.status(409).send({
          error: {
            code: 'CONFLICT',
            message: `Já existe um registro com esse valor em: ${fields}`,
            statusCode: 409,
          },
        })
      }
      if (prismaError.code === 'P2003') {
        return reply.status(422).send({
          error: {
            code: 'FOREIGN_KEY_ERROR',
            message: 'Referência inválida: um dos IDs informados não existe no sistema.',
            statusCode: 422,
          },
        })
      }
      if (prismaError.code === 'P2025') {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Registro não encontrado.',
            statusCode: 404,
          },
        })
      }

      return reply.status(500).send({
        error: {
          code: 'DATABASE_ERROR',
          message: 'Erro ao processar a operação no banco de dados. Tente novamente.',
          statusCode: 500,
        },
      })
    }

    // Prisma validation error (invalid data)
    if (error.name === 'PrismaClientValidationError') {
      fastify.log.error(error)
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos para a operação. Verifique os campos enviados.',
          statusCode: 422,
        },
      })
    }

    // JWT errors
    if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER' || error.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' || error.code === 'FST_JWT_AUTHORIZATION_TOKEN_INVALID') {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Sessão expirada ou token inválido. Faça login novamente.',
          statusCode: 401,
        },
      })
    }

    // Connection / network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      fastify.log.error(error)
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Serviço temporariamente indisponível. Tente novamente em alguns instantes.',
          statusCode: 503,
        },
      })
    }

    // Fallback — log full error but return readable message
    fastify.log.error(error)
    console.error('=== UNHANDLED ERROR ===', error)

    const isDev = env.NODE_ENV === 'development'
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: isDev
          ? `Erro interno: ${error.message}`
          : 'Ocorreu um erro inesperado. Tente novamente ou entre em contato com o suporte.',
        statusCode: 500,
        ...(isDev ? { stack: error.stack } : {}),
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

import type { FastifyInstance } from 'fastify'
import fastifyRateLimit from '@fastify/rate-limit'
import { env } from '../../config/env.js'

export async function rateLimitPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyRateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_TIME_WINDOW,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please slow down.',
    }),
  })
}

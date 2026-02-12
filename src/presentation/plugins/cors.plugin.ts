import type { FastifyInstance } from 'fastify'
import fastifyCors from '@fastify/cors'
import fp from 'fastify-plugin'
import { env } from '../../config/env.js'

async function corsPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyCors, {
    origin: env.CORS_ORIGINS.split(',').map(o => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
}

export default fp(corsPlugin)
export { corsPlugin }

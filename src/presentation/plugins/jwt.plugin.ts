import type { FastifyInstance } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fp from 'fastify-plugin'
import { env } from '../../config/env.js'

async function _jwtPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyJwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    },
  })
}

// fastify-plugin breaks encapsulation so jwt is available to all child scopes
export const jwtPlugin = fp(_jwtPlugin)

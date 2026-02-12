import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { loginUseCase, LoginSchema } from '../../../application/auth/login.usecase.js'
import { refreshTokenUseCase } from '../../../application/auth/refresh-token.usecase.js'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { UnauthorizedError } from '../../../shared/errors/app-error.js'

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /auth/login
  fastify.post('/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login with email and password',
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const body = LoginSchema.parse(request.body)
    const result = await loginUseCase(body, fastify)
    return reply.code(200).send({ data: result })
  })

  // POST /auth/refresh
  fastify.post('/refresh', {
    schema: {
      tags: ['Auth'],
      summary: 'Refresh access token',
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(request.body)
    const result = await refreshTokenUseCase(refreshToken, fastify)
    return reply.code(200).send({ data: result })
  })

  // POST /auth/logout
  fastify.post('/logout', {
    schema: { tags: ['Auth'], summary: 'Logout and revoke refresh token' },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string().optional() }).parse(request.body)

    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }

    // Revoke all tokens for the user on full logout
    await prisma.refreshToken.updateMany({
      where: { userId: request.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    return reply.code(200).send({ message: 'Logged out successfully' })
  })

  // GET /auth/me
  fastify.get('/me', {
    schema: { tags: ['Auth'], summary: 'Get current user profile' },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: {
        id: true,
        email: true,
        nome: true,
        role: true,
        nivel: true,
        xp: true,
        xpProximo: true,
        estrelas: true,
        cargo: true,
        departamento: true,
        avatar: true,
        bio: true,
        telefone: true,
        localizacao: true,
        hiredAt: true,
        isActive: true,
        managerId: true,
        createdAt: true,
        _count: {
          select: { team: true },
        },
      },
    })

    if (!user) throw new UnauthorizedError()

    return reply.code(200).send({ data: user })
  })
}

import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../infrastructure/database/prisma.client.js'
import { UnauthorizedError } from '../../shared/errors/app-error.js'
import { env } from '../../config/env.js'

function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/)
  if (!match) return 7 * 24 * 60 * 60 * 1000
  const value = parseInt(match[1])
  const unit = match[2]
  const multipliers: Record<string, number> = {
    s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000,
  }
  return value * (multipliers[unit] ?? 1000)
}

export async function refreshTokenUseCase(
  token: string,
  fastify: FastifyInstance,
): Promise<{ accessToken: string; refreshToken: string }> {
  const existing = await prisma.refreshToken.findUnique({
    where: { token },
    include: { user: true },
  })

  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
    throw new UnauthorizedError('Invalid or expired refresh token')
  }

  if (!existing.user.isActive) {
    throw new UnauthorizedError('Account deactivated')
  }

  // Revoke old token (rotation)
  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  })

  // New access token
  const accessToken = fastify.jwt.sign({
    id: existing.user.id,
    email: existing.user.email,
    role: existing.user.role,
    nome: existing.user.nome,
  })

  // New refresh token
  const newRefreshToken = crypto.randomBytes(64).toString('hex')
  const expiresAt = new Date(Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN))

  await prisma.refreshToken.create({
    data: {
      token: newRefreshToken,
      userId: existing.userId,
      expiresAt,
    },
  })

  return { accessToken, refreshToken: newRefreshToken }
}

import { z } from 'zod'
import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../infrastructure/database/prisma.client.js'
import { comparePassword } from '../../shared/utils/password.js'
import { UnauthorizedError } from '../../shared/errors/app-error.js'
import { env } from '../../config/env.js'

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export type LoginInput = z.infer<typeof LoginSchema>

export interface LoginOutput {
  accessToken: string
  refreshToken: string
  user: {
    id: string
    email: string
    nome: string
    role: string
    nivel: number
    xp: number
    xpProximo: number
    estrelas: number
    cargo: string
    departamento: string
    avatar: string | null
    bio: string | null
    telefone: string | null
    localizacao: string | null
    hiredAt: Date | null
    createdAt: Date
  }
}

function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/)
  if (!match) return 7 * 24 * 60 * 60 * 1000 // default 7d
  const value = parseInt(match[1])
  const unit = match[2]
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }
  return value * (multipliers[unit] ?? 1000)
}

export async function loginUseCase(
  input: LoginInput,
  fastify: FastifyInstance,
): Promise<LoginOutput> {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  })

  if (!user || !user.isActive) {
    throw new UnauthorizedError('Invalid credentials')
  }

  const passwordMatch = await comparePassword(input.password, user.passwordHash)
  if (!passwordMatch) {
    throw new UnauthorizedError('Invalid credentials')
  }

  // Generate access token
  const accessToken = fastify.jwt.sign({
    id: user.id,
    email: user.email,
    role: user.role,
    nome: user.nome,
  })

  // Generate refresh token (opaque)
  const refreshTokenValue = crypto.randomBytes(64).toString('hex')
  const expiresAt = new Date(Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN))

  await prisma.refreshToken.create({
    data: {
      token: refreshTokenValue,
      userId: user.id,
      expiresAt,
    },
  })

  return {
    accessToken,
    refreshToken: refreshTokenValue,
    user: {
      id: user.id,
      email: user.email,
      nome: user.nome,
      role: user.role,
      nivel: user.nivel,
      xp: user.xp,
      xpProximo: user.xpProximo,
      estrelas: user.estrelas,
      cargo: user.cargo,
      departamento: user.departamento,
      avatar: user.avatar,
      bio: user.bio,
      telefone: user.telefone,
      localizacao: user.localizacao,
      hiredAt: user.hiredAt,
      createdAt: user.createdAt,
    },
  }
}

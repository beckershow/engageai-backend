import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import {
  getLeaderboard,
  getUserRank,
  LEADERBOARD_KEY,
  LEADERBOARD_TTL,
} from '../../../infrastructure/cache/redis.client.js'

export async function rankingRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /ranking/global
  fastify.get('/global', {
    preHandler: [authenticate],
    schema: { tags: ['Ranking'], summary: 'Global XP ranking' },
  }, async (request, reply) => {
    const query = z.object({
      limit: z.coerce.number().min(1).max(100).default(50),
      offset: z.coerce.number().min(0).default(0),
    }).parse(request.query)

    // Try Redis first, fallback to DB if unavailable
    let leaderboard: Array<{ userId: string; xp: number; rank: number }> = []
    try {
      leaderboard = await getLeaderboard(query.offset, query.limit)
    } catch {
      // Redis unavailable, will use DB fallback
    }

    if (leaderboard.length === 0) {
      // Fallback to DB
      const users = await prisma.user.findMany({
        where: { role: 'colaborador', isActive: true },
        orderBy: { xp: 'desc' },
        skip: query.offset,
        take: query.limit,
        select: { id: true, nome: true, cargo: true, departamento: true, avatar: true, nivel: true, xp: true, estrelas: true },
      })

      leaderboard = users.map((u, idx) => ({ userId: u.id, xp: u.xp, rank: query.offset + idx + 1 }))

      // Try to populate Redis (non-blocking)
      try {
        const { redis } = await import('../../../infrastructure/cache/redis.client.js')
        const pipeline = redis.pipeline()
        users.forEach(u => pipeline.zadd(LEADERBOARD_KEY, u.xp, u.id))
        pipeline.expire(LEADERBOARD_KEY, LEADERBOARD_TTL)
        await pipeline.exec()
      } catch {
        // Redis unavailable, skip cache update
      }
    }

    // Enrich with user data
    const userIds = leaderboard.map(e => e.userId)
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nome: true, cargo: true, departamento: true, avatar: true, nivel: true, xp: true, estrelas: true },
    })
    const userMap = new Map(users.map(u => [u.id, u]))

    let currentUserRank: number | null = null
    try {
      currentUserRank = await getUserRank(request.user.id)
    } catch {
      // Redis unavailable
    }

    return reply.send({
      data: {
        ranking: leaderboard.map(e => ({
          rank: e.rank,
          ...userMap.get(e.userId),
          isCurrentUser: e.userId === request.user.id,
        })).filter(e => e.id),
        currentUserRank,
      },
    })
  })

  // GET /ranking/team - team ranking (gestor+)
  fastify.get('/team', {
    preHandler: [authenticate],
    schema: { tags: ['Ranking'], summary: 'Team ranking' },
  }, async (request, reply) => {
    const where = request.user.role === 'super_admin'
      ? { role: 'colaborador' as const, isActive: true }
      : { managerId: request.user.id, isActive: true }

    const team = await prisma.user.findMany({
      where,
      orderBy: { xp: 'desc' },
      select: { id: true, nome: true, cargo: true, departamento: true, avatar: true, nivel: true, xp: true, estrelas: true },
    })

    return reply.send({
      data: team.map((u, idx) => ({
        rank: idx + 1,
        ...u,
        isCurrentUser: u.id === request.user.id,
      })),
    })
  })

  // GET /ranking/department/:dept
  fastify.get('/department/:dept', {
    preHandler: [authenticate],
    schema: { tags: ['Ranking'], summary: 'Department ranking' },
  }, async (request, reply) => {
    const { dept } = z.object({ dept: z.string() }).parse(request.params)

    const users = await prisma.user.findMany({
      where: { departamento: dept, role: 'colaborador', isActive: true },
      orderBy: { xp: 'desc' },
      select: { id: true, nome: true, cargo: true, nivel: true, xp: true, estrelas: true, avatar: true },
    })

    return reply.send({
      data: users.map((u, idx) => ({
        rank: idx + 1,
        ...u,
        isCurrentUser: u.id === request.user.id,
      })),
    })
  })
}

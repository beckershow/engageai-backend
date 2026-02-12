import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { awardXpUseCase, XP_REWARDS } from '../../../application/gamification/award-xp.usecase.js'
import { ConflictError, ForbiddenError } from '../../../shared/errors/app-error.js'

export async function moodRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /mood - register today's mood (once per day)
  fastify.post('/', {
    preHandler: [authenticate],
    schema: { tags: ['Mood'], summary: 'Register daily mood (once per day)' },
  }, async (request, reply) => {
    const body = z.object({
      mood: z.number().int().min(1).max(5),
      note: z.string().max(500).optional(),
    }).parse(request.body)

    const today = new Date().toISOString().split('T')[0]
    const userId = request.user.id

    const existing = await prisma.moodEntry.findUnique({
      where: { userId_date: { userId, date: today } },
    })

    if (existing) {
      throw new ConflictError('Mood already registered for today')
    }

    const entry = await prisma.moodEntry.create({
      data: { userId, date: today, mood: body.mood, note: body.note },
    })

    // Award XP asynchronously
    await awardXpUseCase({
      userId,
      userRole: request.user.role,
      action: 'registrar_humor',
      xp: XP_REWARDS.registrar_humor,
      context: { date: today, mood: body.mood },
    })

    return reply.code(201).send({ data: entry })
  })

  // GET /mood/today - check if user registered mood today
  fastify.get('/today', {
    preHandler: [authenticate],
    schema: { tags: ['Mood'], summary: 'Check if mood registered today' },
  }, async (request, reply) => {
    const today = new Date().toISOString().split('T')[0]
    const entry = await prisma.moodEntry.findUnique({
      where: { userId_date: { userId: request.user.id, date: today } },
    })
    return reply.send({ data: { registered: !!entry, entry } })
  })

  // GET /mood/history - user's mood history
  fastify.get('/history', {
    preHandler: [authenticate],
    schema: { tags: ['Mood'], summary: 'Get mood history' },
  }, async (request, reply) => {
    const query = z.object({
      days: z.coerce.number().min(1).max(365).default(30),
    }).parse(request.query)

    const since = new Date()
    since.setDate(since.getDate() - query.days)
    const sinceStr = since.toISOString().split('T')[0]

    const entries = await prisma.moodEntry.findMany({
      where: {
        userId: request.user.id,
        date: { gte: sinceStr },
      },
      orderBy: { date: 'desc' },
    })

    return reply.send({ data: entries })
  })

  // GET /mood/stats - mood stats for the user
  fastify.get('/stats', {
    preHandler: [authenticate],
    schema: { tags: ['Mood'], summary: 'Get mood stats' },
  }, async (request, reply) => {
    const entries = await prisma.moodEntry.findMany({
      where: { userId: request.user.id },
      orderBy: { date: 'desc' },
      take: 30,
    })

    const total = entries.length
    if (total === 0) return reply.send({ data: { average: null, total: 0, distribution: {} } })

    const sum = entries.reduce((acc, e) => acc + e.mood, 0)
    const average = sum / total

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    entries.forEach(e => { distribution[e.mood] = (distribution[e.mood] ?? 0) + 1 })

    return reply.send({ data: { average: Math.round(average * 10) / 10, total, distribution } })
  })

  // GET /mood/team - team mood (gestor+)
  fastify.get('/team', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Mood'], summary: "Get team's mood data (gestor+)" },
  }, async (request, reply) => {
    const today = new Date().toISOString().split('T')[0]
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0]

    // Get team members
    const teamFilter = request.user.role === 'super_admin'
      ? { isActive: true, role: 'colaborador' as const }
      : { managerId: request.user.id, isActive: true }

    const teamMembers = await prisma.user.findMany({
      where: teamFilter,
      select: { id: true, nome: true, departamento: true },
    })

    const teamIds = teamMembers.map(m => m.id)

    const [todayEntries, weekEntries] = await Promise.all([
      prisma.moodEntry.findMany({
        where: { userId: { in: teamIds }, date: today },
        include: { user: { select: { id: true, nome: true, departamento: true } } },
      }),
      prisma.moodEntry.findMany({
        where: { userId: { in: teamIds }, date: { gte: sevenDaysAgoStr } },
      }),
    ])

    const weekAvg = weekEntries.length > 0
      ? weekEntries.reduce((acc, e) => acc + e.mood, 0) / weekEntries.length
      : null

    return reply.send({
      data: {
        teamSize: teamMembers.length,
        registeredToday: todayEntries.length,
        todayEntries,
        weekAverage: weekAvg ? Math.round(weekAvg * 10) / 10 : null,
        registrationRate: teamMembers.length > 0
          ? Math.round((todayEntries.length / teamMembers.length) * 100)
          : 0,
      },
    })
  })
}

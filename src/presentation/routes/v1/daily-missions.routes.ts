import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { awardXpUseCase } from '../../../application/gamification/award-xp.usecase.js'
import { NotFoundError, ConflictError } from '../../../shared/errors/app-error.js'

export async function dailyMissionsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /daily-missions - get today's missions for user
  fastify.get('/', {
    preHandler: [authenticate],
    schema: { tags: ['Daily Missions'], summary: "Get today's missions" },
  }, async (request, reply) => {
    const today = new Date()
    const dayOfWeek = today.getDay() // 0=Sun...6=Sat
    const todayStr = today.toISOString().split('T')[0]

    const missions = await prisma.dailyMission.findMany({
      where: {
        isActive: true,
        diasAtivos: { has: dayOfWeek },
      },
    })

    const missionIds = missions.map(m => m.id)
    const completions = await prisma.dailyMissionCompletion.findMany({
      where: {
        missionId: { in: missionIds },
        userId: request.user.id,
        date: todayStr,
      },
      select: { missionId: true },
    })
    const completedSet = new Set(completions.map(c => c.missionId))

    return reply.send({
      data: missions.map(m => ({ ...m, completed: completedSet.has(m.id) })),
    })
  })

  // POST /daily-missions/:id/complete
  fastify.post('/:id/complete', {
    preHandler: [authenticate],
    schema: { tags: ['Daily Missions'], summary: 'Complete daily mission' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const today = new Date().toISOString().split('T')[0]

    const mission = await prisma.dailyMission.findUnique({ where: { id } })
    if (!mission || !mission.isActive) throw new NotFoundError('Mission', id)

    const existing = await prisma.dailyMissionCompletion.findUnique({
      where: { missionId_userId_date: { missionId: id, userId: request.user.id, date: today } },
    })
    if (existing) throw new ConflictError('Mission already completed today')

    const completion = await prisma.dailyMissionCompletion.create({
      data: { missionId: id, userId: request.user.id, date: today },
    })

    await awardXpUseCase({
      userId: request.user.id,
      userRole: request.user.role,
      action: 'completar_missao',
      xp: mission.rewardXP,
      stars: mission.rewardStars,
      context: { missionId: id },
    })

    return reply.code(201).send({ data: completion })
  })

  // POST /daily-missions (super_admin)
  fastify.post('/', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Daily Missions'], summary: 'Create daily mission' },
  }, async (request, reply) => {
    const body = z.object({
      nome: z.string().min(1),
      descricao: z.string().optional(),
      actionType: z.string(),
      target: z.number().int().min(1).default(1),
      rewardXP: z.number().int().min(0).default(50),
      rewardStars: z.number().int().min(0).default(0),
      diasAtivos: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]), // Mon-Fri
      publicoAlvoType: z.enum(['todo_time', 'colaboradores_especificos', 'por_departamento']).default('todo_time'),
      targetIds: z.array(z.string()).default([]),
    }).parse(request.body)

    const mission = await prisma.dailyMission.create({
      data: { ...body, actionType: body.actionType as any },
    })
    return reply.code(201).send({ data: mission })
  })

  // PUT /daily-missions/:id (super_admin)
  fastify.put('/:id', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Daily Missions'], summary: 'Update daily mission' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const body = z.object({
      nome: z.string().optional(),
      rewardXP: z.number().int().optional(),
      isActive: z.boolean().optional(),
    }).parse(request.body)

    const mission = await prisma.dailyMission.update({ where: { id }, data: body })
    return reply.send({ data: mission })
  })
}

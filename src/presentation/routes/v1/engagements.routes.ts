import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { awardXpUseCase } from '../../../application/gamification/award-xp.usecase.js'
import { NotFoundError, ForbiddenError } from '../../../shared/errors/app-error.js'
import { getPaginationParams, buildPaginationMeta } from '../../../shared/utils/pagination.js'

export async function engagementsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /engagements
  fastify.get('/', {
    preHandler: [authenticate],
    schema: { tags: ['Engagements'], summary: 'List engagements' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
      active: z.coerce.boolean().optional(),
    }).parse(request.query)

    const { skip, take, page, limit } = getPaginationParams(query)
    const where: any = {}
    if (query.active !== undefined) where.isActive = query.active

    const [engagements, total] = await Promise.all([
      prisma.engajamento.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: { select: { id: true, nome: true } },
          requiredActions: { orderBy: { order: 'asc' } },
          _count: { select: { participants: true } },
        },
      }),
      prisma.engajamento.count({ where }),
    ])

    // Add user participation status
    const engIds = engagements.map(e => e.id)
    const userParts = await prisma.engajamentoParticipant.findMany({
      where: { engajamentoId: { in: engIds }, userId: request.user.id },
      select: { engajamentoId: true, status: true, progressPercentage: true },
    })
    const partMap = new Map(userParts.map(p => [p.engajamentoId, p]))

    return reply.send({
      data: engagements.map(e => ({ ...e, userParticipation: partMap.get(e.id) ?? null })),
      meta: buildPaginationMeta(total, page, limit),
    })
  })

  // GET /engagements/:id
  fastify.get('/:id', {
    preHandler: [authenticate],
    schema: { tags: ['Engagements'], summary: 'Get engagement by ID' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const eng = await prisma.engajamento.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, nome: true } },
        requiredActions: { orderBy: { order: 'asc' } },
        participants: {
          select: {
            id: true, status: true, progressPercentage: true, completedActions: true,
            startedAt: true, completedAt: true,
            user: { select: { id: true, nome: true, avatar: true, departamento: true } },
          },
        },
      },
    })
    if (!eng) throw new NotFoundError('Engagement', id)

    return reply.send({ data: eng })
  })

  // POST /engagements (super_admin)
  fastify.post('/', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Engagements'], summary: 'Create engagement (super_admin)' },
  }, async (request, reply) => {
    const body = z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      type: z.enum(['acesso_consecutivo', 'completar_treinamento', 'interacao_feed', 'dar_feedback', 'responder_pesquisa', 'participar_evento', 'mixed']),
      rewardXP: z.number().int().min(0).default(100),
      rewardStars: z.number().int().min(0).default(5),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      publicoAlvoType: z.enum(['todo_time', 'colaboradores_especificos', 'por_departamento']).default('todo_time'),
      targetIds: z.array(z.string()).default([]),
      completionMethod: z.enum(['automatic', 'manual']).default('automatic'),
      requiredActions: z.array(z.object({
        type: z.string(),
        target: z.number().int().optional(),
        description: z.string().optional(),
        order: z.number().int().default(0),
      })).default([]),
    }).parse(request.body)

    const { requiredActions, ...engData } = body
    const eng = await prisma.engajamento.create({
      data: {
        ...engData,
        startDate: engData.startDate ? new Date(engData.startDate) : undefined,
        endDate: engData.endDate ? new Date(engData.endDate) : undefined,
        creatorId: request.user.id,
        requiredActions: {
          create: requiredActions.map((a, idx) => ({
            ...a,
            type: a.type as any,
            order: a.order || idx,
          })),
        },
      },
      include: { requiredActions: true },
    })

    // Auto-enroll eligible users
    if (eng.publicoAlvoType === 'todo_time') {
      const users = await prisma.user.findMany({
        where: { role: 'colaborador', isActive: true },
        select: { id: true },
      })
      await prisma.engajamentoParticipant.createMany({
        data: users.map(u => ({
          engajamentoId: eng.id,
          userId: u.id,
          status: 'not_started' as const,
        })),
        skipDuplicates: true,
      })
    }

    return reply.code(201).send({ data: eng })
  })

  // POST /engagements/:id/start - user starts engagement
  fastify.post('/:id/start', {
    preHandler: [authenticate],
    schema: { tags: ['Engagements'], summary: 'Start engagement' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const eng = await prisma.engajamento.findUnique({ where: { id } })
    if (!eng || !eng.isActive) throw new NotFoundError('Engagement', id)

    const existing = await prisma.engajamentoParticipant.findUnique({
      where: { engajamentoId_userId: { engajamentoId: id, userId: request.user.id } },
    })

    if (existing) {
      if (existing.status === 'in_progress') return reply.send({ data: existing })
      if (existing.status === 'completed') {
        return reply.send({ data: existing, message: 'Already completed' })
      }
    }

    const participant = await prisma.engajamentoParticipant.upsert({
      where: { engajamentoId_userId: { engajamentoId: id, userId: request.user.id } },
      create: {
        engajamentoId: id,
        userId: request.user.id,
        status: 'in_progress',
        startedAt: new Date(),
      },
      update: {
        status: 'in_progress',
        startedAt: new Date(),
      },
    })

    return reply.code(201).send({ data: participant })
  })

  // POST /engagements/:id/action-complete - complete an action
  fastify.post('/:id/action-complete', {
    preHandler: [authenticate],
    schema: { tags: ['Engagements'], summary: 'Complete an engagement action' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { actionId } = z.object({ actionId: z.string() }).parse(request.body)

    const eng = await prisma.engajamento.findUnique({
      where: { id },
      include: { requiredActions: true },
    })
    if (!eng) throw new NotFoundError('Engagement', id)

    const participant = await prisma.engajamentoParticipant.findUnique({
      where: { engajamentoId_userId: { engajamentoId: id, userId: request.user.id } },
    })
    if (!participant || participant.status === 'completed') {
      throw new ForbiddenError('Not participating or already completed')
    }

    const completedActions = [...new Set([...participant.completedActions, actionId])]
    const progress = Math.round((completedActions.length / eng.requiredActions.length) * 100)
    const isCompleted = progress === 100

    const updated = await prisma.engajamentoParticipant.update({
      where: { id: participant.id },
      data: {
        completedActions,
        progressPercentage: progress,
        status: isCompleted ? 'completed' : 'in_progress',
        completedAt: isCompleted ? new Date() : null,
      },
    })

    if (isCompleted) {
      await awardXpUseCase({
        userId: request.user.id,
        userRole: request.user.role,
        action: 'completar_engajamento',
        xp: eng.rewardXP,
        stars: eng.rewardStars,
        context: { engajamentoId: id },
      })
    }

    return reply.send({ data: updated, completed: isCompleted })
  })

  // GET /engagements/:id/participants (gestor+)
  fastify.get('/:id/participants', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Engagements'], summary: 'Get engagement participants (gestor+)' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const participants = await prisma.engajamentoParticipant.findMany({
      where: { engajamentoId: id },
      include: {
        user: { select: { id: true, nome: true, cargo: true, departamento: true, avatar: true } },
      },
      orderBy: { progressPercentage: 'desc' },
    })

    return reply.send({ data: participants })
  })
}

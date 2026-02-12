import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { awardXpUseCase, XP_REWARDS, STAR_REWARDS } from '../../../application/gamification/award-xp.usecase.js'
import { NotFoundError, ForbiddenError } from '../../../shared/errors/app-error.js'
import { getPaginationParams, buildPaginationMeta } from '../../../shared/utils/pagination.js'

export async function feedbacksRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /feedbacks - list feedbacks
  fastify.get('/', {
    preHandler: [authenticate],
    schema: { tags: ['Feedbacks'], summary: 'List feedbacks' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
      type: z.enum(['sent', 'received', 'pending']).optional(),
      status: z.enum(['pendente', 'aprovado', 'rejeitado']).optional(),
    }).parse(request.query)

    const { skip, take, page, limit } = getPaginationParams(query)
    const userId = request.user.id
    const isAdmin = request.user.role === 'super_admin'
    const isGestor = request.user.role === 'gestor'

    let where: any = {}
    if (query.type === 'sent') {
      where.fromUserId = userId
    } else if (query.type === 'received') {
      where.toUserId = userId
    } else if (query.type === 'pending' && (isAdmin || isGestor)) {
      where.status = 'pendente'
    } else if (!isAdmin) {
      where.OR = [{ fromUserId: userId }, { toUserId: userId }]
    }

    if (query.status) where.status = query.status

    const [feedbacks, total] = await Promise.all([
      prisma.feedback.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          fromUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
          toUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
        },
      }),
      prisma.feedback.count({ where }),
    ])

    // Hide sender for anonymous feedbacks (unless admin)
    const sanitized = feedbacks.map(f => ({
      ...f,
      fromUser: f.isAnonymous && !isAdmin && f.toUserId === userId ? null : f.fromUser,
    }))

    return reply.send({ data: sanitized, meta: buildPaginationMeta(total, page, limit) })
  })

  // POST /feedbacks - send feedback
  fastify.post('/', {
    preHandler: [authenticate],
    schema: { tags: ['Feedbacks'], summary: 'Send feedback' },
  }, async (request, reply) => {
    const body = z.object({
      toUserId: z.string(),
      type: z.enum(['reconhecimento', 'sugestao', 'critica_construtiva', 'agradecimento', 'desenvolvimento']),
      content: z.string().min(10).max(2000),
      isPublic: z.boolean().default(false),
      isAnonymous: z.boolean().default(false),
    }).parse(request.body)

    if (body.toUserId === request.user.id) {
      throw new ForbiddenError('Cannot send feedback to yourself')
    }

    // Check daily limit
    const settings = await prisma.feedbackSettings.findUnique({ where: { id: 'singleton' } })
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const countToday = await prisma.feedback.count({
      where: { fromUserId: request.user.id, createdAt: { gte: today } },
    })
    if (settings && countToday >= settings.maxFeedbacksPerDay) {
      throw new ForbiddenError(`Daily feedback limit (${settings.maxFeedbacksPerDay}) reached`)
    }

    const requireApproval = settings?.requireApproval ?? true

    const feedback = await prisma.feedback.create({
      data: {
        fromUserId: request.user.id,
        ...body,
        status: requireApproval ? 'pendente' : 'aprovado',
      },
      include: {
        toUser: { select: { id: true, nome: true, cargo: true } },
      },
    })

    await awardXpUseCase({
      userId: request.user.id,
      userRole: request.user.role,
      action: 'dar_feedback',
      xp: XP_REWARDS.dar_feedback,
      stars: STAR_REWARDS.dar_feedback,
    })

    return reply.code(201).send({ data: feedback })
  })

  // GET /feedbacks/:id
  fastify.get('/:id', {
    preHandler: [authenticate],
    schema: { tags: ['Feedbacks'], summary: 'Get feedback by ID' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const feedback = await prisma.feedback.findUnique({
      where: { id },
      include: {
        fromUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
        toUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
      },
    })
    if (!feedback) throw new NotFoundError('Feedback', id)

    const canView = feedback.fromUserId === request.user.id ||
      feedback.toUserId === request.user.id ||
      request.user.role !== 'colaborador'

    if (!canView) throw new ForbiddenError()

    return reply.send({ data: feedback })
  })

  // PATCH /feedbacks/:id/approve - approve (gestor+)
  fastify.patch('/:id/approve', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feedbacks'], summary: 'Approve feedback (gestor+)' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { note } = z.object({ note: z.string().optional() }).parse(request.body ?? {})

    const feedback = await prisma.feedback.update({
      where: { id },
      data: {
        status: 'aprovado',
        reviewedBy: request.user.id,
        reviewedAt: new Date(),
        reviewNote: note,
      },
    })

    return reply.send({ data: feedback })
  })

  // PATCH /feedbacks/:id/reject
  fastify.patch('/:id/reject', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feedbacks'], summary: 'Reject feedback (gestor+)' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { note } = z.object({ note: z.string().optional() }).parse(request.body ?? {})

    const feedback = await prisma.feedback.update({
      where: { id },
      data: {
        status: 'rejeitado',
        reviewedBy: request.user.id,
        reviewedAt: new Date(),
        reviewNote: note,
      },
    })

    return reply.send({ data: feedback })
  })

  // GET /feedbacks/settings - get settings (admin)
  fastify.get('/settings', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Feedbacks'], summary: 'Get feedback settings' },
  }, async (_request, reply) => {
    let settings = await prisma.feedbackSettings.findUnique({ where: { id: 'singleton' } })
    if (!settings) {
      settings = await prisma.feedbackSettings.create({
        data: { id: 'singleton' },
      })
    }
    return reply.send({ data: settings })
  })

  // PUT /feedbacks/settings - update settings (admin)
  fastify.put('/settings', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Feedbacks'], summary: 'Update feedback settings' },
  }, async (request, reply) => {
    const body = z.object({
      maxFeedbacksPerDay: z.number().int().min(1).max(50).optional(),
      allowPublicFeedback: z.boolean().optional(),
      requireApproval: z.boolean().optional(),
      allowAnonymous: z.boolean().optional(),
    }).parse(request.body)

    const settings = await prisma.feedbackSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...body },
      update: body,
    })

    return reply.send({ data: settings })
  })
}

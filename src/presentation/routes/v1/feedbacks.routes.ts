import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { awardXpUseCase, XP_REWARDS, STAR_REWARDS } from '../../../application/gamification/award-xp.usecase.js'
import { enqueueNotification } from '../../../infrastructure/queue/bullmq.client.js'
import { NotFoundError, ForbiddenError } from '../../../shared/errors/app-error.js'
import { getPaginationParams, buildPaginationMeta } from '../../../shared/utils/pagination.js'
import { FeedbackIntelligenceService } from '../../../application/ai/feedback-intelligence.service.js'

// ─── Constantes ───────────────────────────────────────────────────────────────

const feedbackTypeLabels: Record<string, string> = {
  reconhecimento: 'Reconhecimento',
  sugestao: 'Sugestão',
  critica_construtiva: 'Melhoria Construtiva',
  agradecimento: 'Agradecimento',
  desenvolvimento: 'Desenvolvimento',
}

// ─── Helper: buscar config efetiva do gestor para um usuário ─────────────────

async function getEffectiveConfig(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, managerId: true },
  })

  const gestorId = user?.role === 'gestor' ? userId : user?.managerId ?? null
  const global = await prisma.feedbackSettings.findUnique({ where: { id: 'singleton' } })

  if (!gestorId) {
    return {
      allowAnyUser: true,
      allowPublicFeedback: global?.allowPublicFeedback ?? true,
      requireApproval: global?.requireApproval ?? true,
      limitsEnabled: true,
      maxFeedbacksPerDay: null as number | null,
      maxFeedbacksPerWeek: null as number | null,
      individualLimitsEnabled: false,
    }
  }

  const config = await prisma.gestorFeedbackConfig.findUnique({ where: { gestorId } })

  return {
    allowAnyUser: config?.allowAnyUser ?? true,
    allowPublicFeedback: config?.allowPublicFeedback ?? true,
    requireApproval: config?.requireApproval ?? global?.requireApproval ?? false,
    limitsEnabled: config?.limitsEnabled ?? true,
    maxFeedbacksPerDay: config?.maxFeedbacksPerDay ?? null,
    maxFeedbacksPerWeek: config?.maxFeedbacksPerWeek ?? null,
    individualLimitsEnabled: config?.individualLimitsEnabled ?? false,
  }
}

// ─── Helper: criar FeedPost para feedback público ─────────────────────────────

async function createPublicFeedbackPost(feedback: {
  id: string
  toUserId: string
  type: string
  content: string
  fromUser?: { nome: string } | null
  toUser?: { nome: string } | null
}) {
  const senderName = feedback.fromUser?.nome ?? 'Um colega'
  const recipientName = feedback.toUser?.nome ?? 'alguém'
  const typeLabel = feedbackTypeLabels[feedback.type] ?? feedback.type

  const postContent = `🎉 *${senderName}* enviou um feedback de **${typeLabel}** para *${recipientName}*:\n\n"${feedback.content}"`

  const post = await prisma.feedPost.create({
    data: {
      userId: feedback.toUserId,
      content: postContent,
      status: 'approved',
      approvedAt: new Date(),
    },
  })

  return post
}

export async function feedbacksRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── GET /feedbacks — listar feedbacks ───────────────────────────────────────
  fastify.get('/', {
    preHandler: [authenticate],
    schema: { tags: ['Feedbacks'], summary: 'List feedbacks' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
      type: z.enum(['sent', 'received', 'pending', 'team-reviewed']).optional(),
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
      where.status = 'aprovado'
    } else if (query.type === 'pending' && isAdmin) {
      where.status = 'pendente'
    } else if (query.type === 'pending' && isGestor) {
      // Only show pending feedbacks from the gestor's team
      where.status = 'pendente'
      where.fromUser = { managerId: userId }
    } else if (query.type === 'team-reviewed' && (isAdmin || isGestor)) {
      // Processed feedbacks (approved/rejected) from the gestor's team
      where.status = { in: ['aprovado', 'rejeitado'] }
      if (isGestor) where.fromUser = { managerId: userId }
    } else if (!isAdmin) {
      where.OR = [{ fromUserId: userId }, { toUserId: userId }]
    }

    if (query.status) where.status = query.status

    const [feedbacks, total] = await Promise.all([
      prisma.feedback.findMany({
        where, skip, take,
        orderBy: { createdAt: 'desc' },
        include: {
          fromUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
          toUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
        },
      }),
      prisma.feedback.count({ where }),
    ])

    return reply.send({ data: feedbacks, meta: buildPaginationMeta(total, page, limit) })
  })

  // ─── GET /feedbacks/stats — contadores + config efetiva ──────────────────────
  fastify.get('/stats', {
    preHandler: [authenticate],
    schema: { tags: ['Feedbacks'], summary: 'Get feedback stats and effective config' },
  }, async (request, reply) => {
    const userId = request.user.id
    const globalSettings = await prisma.feedbackSettings.findUnique({ where: { id: 'singleton' } })
    const effectiveConfig = await getEffectiveConfig(userId)

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const startOfWeek = new Date(); startOfWeek.setHours(0, 0, 0, 0)
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0)

    const [sentToday, sentThisWeek, sentThisMonth, totalSent,
      totalReceived, receivedThisMonth, pendingRequests] = await Promise.all([
        prisma.feedback.count({ where: { fromUserId: userId, createdAt: { gte: today } } }),
        prisma.feedback.count({ where: { fromUserId: userId, createdAt: { gte: startOfWeek } } }),
        prisma.feedback.count({ where: { fromUserId: userId, createdAt: { gte: startOfMonth } } }),
        prisma.feedback.count({ where: { fromUserId: userId } }),
        prisma.feedback.count({ where: { toUserId: userId, status: 'aprovado' } }),
        prisma.feedback.count({ where: { toUserId: userId, status: 'aprovado', createdAt: { gte: startOfMonth } } }),
        prisma.feedbackRequest.count({ where: { toUserId: userId, status: 'pending' } }),
      ])

    return reply.send({
      data: {
        sentToday, sentThisWeek, sentThisMonth, totalSent,
        totalReceived, receivedThisMonth, pendingRequests,
        dailyLimit: globalSettings?.maxFeedbacksPerDay ?? 5,
        weeklyLimit: globalSettings?.maxFeedbacksPerWeek ?? 20,
        limitsEnabled: globalSettings?.limitsEnabled ?? true,
        requireApproval: effectiveConfig?.requireApproval ?? true,
        allowPublicFeedback: effectiveConfig?.allowPublicFeedback ?? true,
        allowAnyUser: effectiveConfig?.allowAnyUser ?? true,
      },
    })
  })

  // ─── GET /feedbacks/config — config do gestor autenticado ────────────────────
  fastify.get('/config', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feedbacks'], summary: "Get gestor's own feedback config" },
  }, async (request, reply) => {
    const [config, globalSettings] = await Promise.all([
      prisma.gestorFeedbackConfig.findUnique({ where: { gestorId: request.user.id } }),
      prisma.feedbackSettings.findUnique({ where: { id: 'singleton' } }),
    ])
    const data = config ?? await prisma.gestorFeedbackConfig.create({ data: { gestorId: request.user.id } })
    return reply.send({
      data,
      globalDefaults: {
        limitsEnabled: globalSettings?.limitsEnabled ?? true,
        maxFeedbacksPerDay: globalSettings?.maxFeedbacksPerDay ?? 5,
        maxFeedbacksPerWeek: globalSettings?.maxFeedbacksPerWeek ?? 20,
      },
    })
  })

  // ─── PATCH /feedbacks/config — salvar config do gestor ──────────────────────
  fastify.patch('/config', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feedbacks'], summary: "Save gestor's feedback config" },
  }, async (request, reply) => {
    const body = z.object({
      allowAnyUser: z.boolean().optional(),
      allowPublicFeedback: z.boolean().optional(),
      requireApproval: z.boolean().optional(),
      limitsEnabled: z.boolean().optional(),
      maxFeedbacksPerDay: z.number().int().min(1).max(50).optional(),
      maxFeedbacksPerWeek: z.number().int().min(1).max(200).optional(),
      individualLimitsEnabled: z.boolean().optional(),
    }).parse(request.body)

    const config = await prisma.gestorFeedbackConfig.upsert({
      where: { gestorId: request.user.id },
      create: { gestorId: request.user.id, ...body },
      update: body,
    })

    return reply.send({ data: config })
  })

  // ─── GET /feedbacks/suggestions — autocomplete de destinatários ──────────────
  fastify.get('/suggestions', {
    preHandler: [authenticate],
    schema: { tags: ['Feedbacks'], summary: 'Get suggested users to give feedback to' },
  }, async (request, reply) => {
    const { search } = z.object({ search: z.string().optional() }).parse(request.query)
    const userId = request.user.id
    const isAdmin = request.user.role === 'super_admin'
    const isGestor = request.user.role === 'gestor'
    const nameFilter = search ? { nome: { contains: search, mode: 'insensitive' as const } } : {}

    let users: any[]

    if (isAdmin) {
      users = await prisma.user.findMany({
        where: { id: { not: userId }, isActive: true, ...nameFilter },
        select: { id: true, nome: true, cargo: true, departamento: true, avatar: true, role: true },
        take: 10, orderBy: { nome: 'asc' },
      })
    } else if (isGestor) {
      const config = await prisma.gestorFeedbackConfig.findUnique({ where: { gestorId: userId } })
      const allowAny = config?.allowAnyUser ?? true

      if (allowAny) {
        users = await prisma.user.findMany({
          where: { id: { not: userId }, isActive: true, ...nameFilter },
          select: { id: true, nome: true, cargo: true, departamento: true, avatar: true, role: true },
          take: 10, orderBy: { nome: 'asc' },
        })
      } else {
        users = await prisma.user.findMany({
          where: { managerId: userId, isActive: true, ...nameFilter },
          select: { id: true, nome: true, cargo: true, departamento: true, avatar: true, role: true },
          take: 10, orderBy: { nome: 'asc' },
        })
      }
    } else {
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { managerId: true } })
      const gestorConfig = me?.managerId
        ? await prisma.gestorFeedbackConfig.findUnique({ where: { gestorId: me.managerId } })
        : null
      const allowAny = gestorConfig?.allowAnyUser ?? true

      if (allowAny) {
        users = await prisma.user.findMany({
          where: { id: { not: userId }, isActive: true, ...nameFilter },
          select: { id: true, nome: true, cargo: true, departamento: true, avatar: true, role: true },
          take: 10, orderBy: { nome: 'asc' },
        })
      } else {
        const orClauses: any[] = me?.managerId
          ? [{ managerId: me.managerId }, { id: me.managerId }]
          : [{ id: { not: userId } }]
        users = await prisma.user.findMany({
          where: { id: { not: userId }, isActive: true, OR: orClauses, ...nameFilter },
          select: { id: true, nome: true, cargo: true, departamento: true, avatar: true, role: true },
          take: 10, orderBy: { nome: 'asc' },
        })
      }
    }

    return reply.send({ data: users })
  })

  // ─── GET /feedbacks/:id ──────────────────────────────────────────────────────
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

    const canView =
      feedback.fromUserId === request.user.id ||
      feedback.toUserId === request.user.id ||
      request.user.role !== 'colaborador'
    if (!canView) throw new ForbiddenError()

    return reply.send({ data: feedback })
  })

  // ─── POST /feedbacks — enviar feedback ───────────────────────────────────────
  fastify.post('/', {
    preHandler: [authenticate],
    schema: { tags: ['Feedbacks'], summary: 'Send feedback' },
  }, async (request, reply) => {
    const body = z.object({
      toUserId: z.string(),
      type: z.enum(['reconhecimento', 'sugestao', 'critica_construtiva', 'agradecimento', 'desenvolvimento']),
      content: z.string().min(10).max(2000),
      isPublic: z.boolean().default(false),
      requestId: z.string().optional(),
    }).parse(request.body)

    if (body.toUserId === request.user.id) {
      throw new ForbiddenError('Não é possível enviar feedback para si mesmo')
    }

    const recipient = await prisma.user.findUnique({
      where: { id: body.toUserId },
      select: { id: true, nome: true, role: true },
    })
    if (!recipient) throw new NotFoundError('User', body.toUserId)

    const [effectiveConfig, globalSettings] = await Promise.all([
      getEffectiveConfig(request.user.id),
      prisma.feedbackSettings.findUnique({ where: { id: 'singleton' } }),
    ])

    const isPublic = body.isPublic && effectiveConfig.allowPublicFeedback

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const startOfWeek = new Date(); startOfWeek.setHours(0, 0, 0, 0)
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())

    const [countToday, countThisWeek, userLimit] = await Promise.all([
      prisma.feedback.count({ where: { fromUserId: request.user.id, createdAt: { gte: today } } }),
      prisma.feedback.count({ where: { fromUserId: request.user.id, createdAt: { gte: startOfWeek } } }),
      prisma.userFeedbackLimit.findUnique({ where: { userId: request.user.id } }),
    ])

    // Prioridade: global.limitsEnabled → gestor.limitsEnabled → individual → gestor → global
    if (globalSettings?.limitsEnabled !== false && effectiveConfig.limitsEnabled !== false) {
      const indEnabled = effectiveConfig.individualLimitsEnabled
      const maxDay = (indEnabled && userLimit?.maxFeedbacksPerDay)
        ? userLimit.maxFeedbacksPerDay
        : (effectiveConfig.maxFeedbacksPerDay ?? globalSettings?.maxFeedbacksPerDay ?? 5)
      const maxWeek = (indEnabled && userLimit?.maxFeedbacksPerWeek)
        ? userLimit.maxFeedbacksPerWeek
        : (effectiveConfig.maxFeedbacksPerWeek ?? globalSettings?.maxFeedbacksPerWeek ?? 20)
      if (countToday >= maxDay) throw new ForbiddenError(`Limite diário de feedbacks atingido (${maxDay}/dia)`)
      if (countThisWeek >= maxWeek) throw new ForbiddenError(`Limite semanal de feedbacks atingido (${maxWeek}/semana)`)
    }

    const finalStatus = effectiveConfig.requireApproval ? 'pendente' : 'aprovado'

    const feedback = await prisma.feedback.create({
      data: {
        fromUserId: request.user.id,
        toUserId: body.toUserId,
        type: body.type,
        content: body.content,
        isPublic,
        status: finalStatus,
      },
      include: {
        fromUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
        toUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
      },
    })

    const sender = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: { nome: true },
    })
    const senderName = sender?.nome ?? 'Um colega'
    const typeLabel = feedbackTypeLabels[body.type] ?? body.type

    if (body.requestId) {
      const fulfilledReq = await prisma.feedbackRequest.findUnique({
        where: { id: body.requestId },
        select: { fromUserId: true, topic: true },
      }).catch(() => null)

      await prisma.feedbackRequest.update({
        where: { id: body.requestId },
        data: { status: 'fulfilled', feedbackId: feedback.id },
      }).catch((err) => {
        fastify.log.error(`[Feedback Request Update Error] ${err.message}`)
      })

      if (fulfilledReq) {
        await enqueueNotification({
          userId: fulfilledReq.fromUserId,
          type: 'feedback_request_fulfilled',
          title: 'Sua solicitação foi atendida! 🎉',
          message: `${senderName} respondeu à sua solicitação de feedback${fulfilledReq.topic ? ` sobre "${fulfilledReq.topic}"` : ''}.`,
          data: { feedbackId: feedback.id, fromUserId: request.user.id },
        }).catch((err) => {
          fastify.log.error(`[Notification Error - Request Fulfilled] ${err.message}`)
        })
      }
    }

    if (finalStatus === 'aprovado') {
      await enqueueNotification({
        userId: body.toUserId,
        type: 'feedback_received',
        title: 'Novo feedback recebido! 🎉',
        message: `${senderName} enviou um feedback de ${typeLabel} para você.`,
        data: { feedbackId: feedback.id, senderId: request.user.id, type: body.type },
      }).catch((err) => {
        fastify.log.error(`[Notification Error - Feedback Received] ${err.message}`)
      })

      if (isPublic) {
        await createPublicFeedbackPost({
          id: feedback.id,
          toUserId: feedback.toUserId,
          type: feedback.type,
          content: feedback.content,
          fromUser: feedback.fromUser,
          toUser: feedback.toUser,
        }).catch((err) => {
          fastify.log.error(`[Public Feedback Post Error] ${err.message}`)
        })
      }
    } else if (finalStatus === 'pendente') {
      // Notifica o gestor que há um feedback aguardando aprovação
      const gestorId = request.user.managerId
      if (gestorId) {
        await enqueueNotification({
          userId: gestorId,
          type: 'feedback_pending_approval',
          title: 'Feedback aguardando aprovação ⏳',
          message: `${senderName} enviou um feedback de ${typeLabel} que precisa da sua aprovação.`,
          data: { feedbackId: feedback.id, fromUserId: request.user.id, type: body.type },
        }).catch((err) => {
          fastify.log.error(`[Notification Error - Pending Approval] ${err.message}`)
        })
      }
    }

    FeedbackIntelligenceService.processAndPersist(feedback.id).catch(err => {
      fastify.log.error(`[AI Feedback Error] ${err.message}`)
    })

    return reply.code(201).send({
      data: feedback,
      meta: { sentToday: countToday + 1, sentThisWeek: countThisWeek + 1, weeklyLimit: globalSettings?.maxFeedbacksPerWeek ?? 20 },
    })
  })

  // ─── PATCH /feedbacks/:id/approve — aprovar (gestor+) ───────────────────────
  fastify.patch('/:id/approve', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feedbacks'], summary: 'Approve feedback' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { note } = z.object({ note: z.string().optional() }).parse(request.body ?? {})

    const feedback = await prisma.feedback.update({
      where: { id },
      data: { status: 'aprovado', reviewedBy: request.user.id, reviewedAt: new Date(), reviewNote: note },
      include: {
        fromUser: { select: { id: true, nome: true } },
        toUser: { select: { id: true, nome: true } },
      },
    })

    const typeLabel = feedbackTypeLabels[feedback.type] ?? feedback.type
    const senderName = feedback.fromUser?.nome ?? 'Um colega'

    await Promise.all([
      enqueueNotification({
        userId: feedback.toUserId,
        type: 'feedback_received',
        title: 'Novo feedback recebido! 🎉',
        message: `${senderName} enviou um feedback de ${typeLabel} para você.`,
        data: { feedbackId: feedback.id, type: feedback.type },
      }),
      enqueueNotification({
        userId: feedback.fromUserId,
        type: 'feedback_approved',
        title: 'Seu feedback foi aprovado ✅',
        message: `Seu feedback de ${typeLabel} para ${feedback.toUser?.nome ?? 'seu colega'} foi aprovado e entregue.`,
        data: { feedbackId: feedback.id },
      }),
    ]).catch((err) => {
      fastify.log.error(`[Notification Error - Feedback Approval] ${err.message}`)
    })

    if (feedback.isPublic) {
      await createPublicFeedbackPost({
        id: feedback.id,
        toUserId: feedback.toUserId,
        type: feedback.type,
        content: feedback.content,
        fromUser: feedback.fromUser,
        toUser: feedback.toUser,
      }).catch((err) => {
        fastify.log.error(`[Public Feedback Post Error - Approval] ${err.message}`)
      })
    }

    FeedbackIntelligenceService.processAndPersist(feedback.id).catch((err) => {
      fastify.log.error(`[AI Feedback Error - Approval] ${err.message}`)
    })

    return reply.send({ data: feedback })
  })

  // ─── PATCH /feedbacks/:id/reject — rejeitar (gestor+) ───────────────────────
  fastify.patch('/:id/reject', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feedbacks'], summary: 'Reject feedback' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { note } = z.object({ note: z.string().optional() }).parse(request.body ?? {})

    const feedback = await prisma.feedback.update({
      where: { id },
      data: { status: 'rejeitado', reviewedBy: request.user.id, reviewedAt: new Date(), reviewNote: note },
      include: { toUser: { select: { id: true, nome: true } } },
    })

    const typeLabel = feedbackTypeLabels[feedback.type] ?? feedback.type
    await enqueueNotification({
      userId: feedback.fromUserId,
      type: 'feedback_rejected',
      title: 'Feedback não aprovado',
      message: `Seu feedback de ${typeLabel} para ${feedback.toUser?.nome ?? 'seu colega'} não foi aprovado.${note ? ` Motivo: ${note}` : ''}`,
      data: { feedbackId: feedback.id, reviewNote: note },
    }).catch((err) => {
      fastify.log.error(`[Notification Error - Feedback Rejection] ${err.message}`)
    })

    return reply.send({ data: feedback })
  })

  // ─── DELETE /feedbacks/:id — remover feedback rejeitado (apenas remetente) ───
  fastify.delete('/:id', {
    preHandler: [authenticate],
    schema: { tags: ['Feedbacks'], summary: 'Delete a rejected feedback (sender only)' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const feedback = await prisma.feedback.findUnique({ where: { id } })
    if (!feedback) throw new NotFoundError('Feedback', id)
    if (feedback.fromUserId !== request.user.id) throw new ForbiddenError()
    if (feedback.status !== 'rejeitado') throw new ForbiddenError('Só é possível remover feedbacks rejeitados')

    await prisma.feedback.delete({ where: { id } })

    return reply.code(204).send()
  })

  // ─── GET /feedbacks/team-limits — limites individuais do time (gestor) ──────
  fastify.get('/team-limits', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feedbacks'], summary: 'List team members with individual feedback limits' },
  }, async (request, reply) => {
    const gestorId = request.user.id

    const [members, globalSettings] = await Promise.all([
      prisma.user.findMany({
        where: { managerId: gestorId, isActive: true },
        select: {
          id: true, nome: true, cargo: true, avatar: true,
          userFeedbackLimit: { select: { id: true, maxFeedbacksPerDay: true, maxFeedbacksPerWeek: true } },
        },
        orderBy: { nome: 'asc' },
      }),
      prisma.feedbackSettings.findUnique({ where: { id: 'singleton' } }),
    ])

    return reply.send({
      data: {
        members: members.map(m => ({
          userId: m.id, nome: m.nome, cargo: m.cargo, avatar: m.avatar,
          customLimit: m.userFeedbackLimit ?? null,
        })),
        globalDefaults: {
          limitsEnabled: globalSettings?.limitsEnabled ?? true,
          maxFeedbacksPerDay: globalSettings?.maxFeedbacksPerDay ?? 5,
          maxFeedbacksPerWeek: globalSettings?.maxFeedbacksPerWeek ?? 20,
        },
      },
    })
  })

  // ─── PUT /feedbacks/team-limits/:userId — definir limite individual (gestor) ─
  fastify.put('/team-limits/:userId', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feedbacks'], summary: 'Set individual feedback limit for a team member' },
  }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string() }).parse(request.params)
    const body = z.object({
      maxFeedbacksPerDay: z.number().int().min(1).max(50).nullable(),
      maxFeedbacksPerWeek: z.number().int().min(1).max(200).nullable(),
    }).parse(request.body)

    const member = await prisma.user.findUnique({ where: { id: userId }, select: { managerId: true } })
    if (!member || member.managerId !== request.user.id) {
      throw new ForbiddenError('Este colaborador não pertence ao seu time')
    }

    const limit = await prisma.userFeedbackLimit.upsert({
      where: { userId },
      create: { userId, gestorId: request.user.id, ...body },
      update: { ...body, gestorId: request.user.id },
    })

    return reply.send({ data: limit })
  })

  // ─── DELETE /feedbacks/team-limits/:userId — remover limite individual ────────
  fastify.delete('/team-limits/:userId', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feedbacks'], summary: 'Remove individual feedback limit for a team member' },
  }, async (request, reply) => {
    const { userId } = z.object({ userId: z.string() }).parse(request.params)

    const existing = await prisma.userFeedbackLimit.findUnique({ where: { userId } })
    if (!existing || existing.gestorId !== request.user.id) {
      throw new ForbiddenError('Limite não encontrado ou sem permissão')
    }

    await prisma.userFeedbackLimit.delete({ where: { userId } })
    return reply.code(204).send()
  })

  // ─── GET /feedbacks/settings — configurações globais (superadmin) ────────────
  fastify.get('/settings', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Feedbacks'], summary: 'Get global feedback settings' },
  }, async (_request, reply) => {
    let settings = await prisma.feedbackSettings.findUnique({ where: { id: 'singleton' } })
    if (!settings) settings = await prisma.feedbackSettings.create({ data: { id: 'singleton' } })
    return reply.send({ data: settings })
  })

  // ─── PUT /feedbacks/settings — atualizar configurações globais (superadmin) ──
  fastify.put('/settings', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Feedbacks'], summary: 'Update global feedback settings' },
  }, async (request, reply) => {
    const body = z.object({
      limitsEnabled: z.boolean().optional(),
      maxFeedbacksPerDay: z.number().int().min(1).max(50).optional(),
      maxFeedbacksPerWeek: z.number().int().min(1).max(200).optional(),
      individualLimitsEnabled: z.boolean().optional(),
      allowPublicFeedback: z.boolean().optional(),
      requireApproval: z.boolean().optional(),
    }).parse(request.body)

    const settings = await prisma.feedbackSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...body },
      update: body,
    })
    return reply.send({ data: settings })
  })

  // ─── GET /feedbacks/requests — listar solicitações ──────────────────────────
  fastify.get('/requests', {
    preHandler: [authenticate],
    schema: { tags: ['Feedbacks'], summary: 'List feedback requests' },
  }, async (request, reply) => {
    const { type } = z.object({ type: z.enum(['sent', 'received']).default('received') }).parse(request.query)
    const userId = request.user.id

    const requests = await prisma.feedbackRequest.findMany({
      where: type === 'sent' ? { fromUserId: userId } : { toUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        fromUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
        toUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
      },
    })

    return reply.send({ data: requests })
  })

  // ─── POST /feedbacks/requests — criar solicitação ────────────────────────────
  fastify.post('/requests', {
    preHandler: [authenticate],
    schema: { tags: ['Feedbacks'], summary: 'Request feedback from a colleague' },
  }, async (request, reply) => {
    const body = z.object({
      toUserId: z.string(),
      topic: z.string().min(3).max(200).optional(),
      message: z.string().max(1000).optional(),
    }).parse(request.body)

    if (body.toUserId === request.user.id) {
      throw new ForbiddenError('Não é possível solicitar feedback de si mesmo')
    }

    const recipient = await prisma.user.findUnique({ where: { id: body.toUserId }, select: { id: true, nome: true } })
    if (!recipient) throw new NotFoundError('User', body.toUserId)

    const feedbackRequest = await prisma.feedbackRequest.create({
      data: { fromUserId: request.user.id, toUserId: body.toUserId, topic: body.topic, message: body.message },
      include: {
        fromUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
        toUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
      },
    })

    const sender = await prisma.user.findUnique({ where: { id: request.user.id }, select: { nome: true } })
    await enqueueNotification({
      userId: body.toUserId,
      type: 'feedback_request_received',
      title: 'Solicitação de feedback 📬',
      message: `${sender?.nome ?? 'Um colega'} está pedindo seu feedback${body.topic ? ` sobre "${body.topic}"` : ''}.`,
      data: { requestId: feedbackRequest.id, fromUserId: request.user.id },
    }).catch((err) => {
      fastify.log.error(`[Notification Error - Request Received] ${err.message}`)
    })

    return reply.code(201).send({ data: feedbackRequest })
  })

  // ─── PATCH /feedbacks/:id/resend — reenviar feedback rejeitado ───────────────
  fastify.patch('/:id/resend', {
    preHandler: [authenticate],
    schema: { tags: ['Feedbacks'], summary: 'Resend a rejected feedback with optional new content' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const body = z.object({ content: z.string().min(10).optional() }).parse(request.body ?? {})

    const feedback = await prisma.feedback.findUnique({
      where: { id },
      include: { fromUser: { select: { managerId: true, nome: true } }, toUser: { select: { nome: true } } },
    })
    if (!feedback) throw new NotFoundError('Feedback', id)
    if (feedback.fromUserId !== request.user.id) throw new ForbiddenError()
    if (feedback.status !== 'rejeitado') throw new ForbiddenError('Só é possível reenviar feedbacks rejeitados')

    const managerId = feedback.fromUser?.managerId ?? null
    const effectiveConfig = await getEffectiveConfig(request.user.id)
    const finalStatus = effectiveConfig.requireApproval && managerId ? 'pendente' : 'aprovado'

    const updated = await prisma.feedback.update({
      where: { id },
      data: {
        content: body.content ?? feedback.content,
        status: finalStatus,
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
      },
      include: {
        fromUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
        toUser: { select: { id: true, nome: true, cargo: true, avatar: true } },
      },
    })

    const typeLabel = feedbackTypeLabels[updated.type] ?? updated.type
    const senderName = updated.fromUser?.nome ?? 'Um colega'

    if (finalStatus === 'pendente' && managerId) {
      await enqueueNotification({
        userId: managerId,
        type: 'feedback_pending_approval',
        title: 'Novo feedback aguardando aprovação',
        message: `${senderName} reenviou um feedback de ${typeLabel} para revisão.`,
        data: { feedbackId: updated.id },
      }).catch((err) => {
        fastify.log.error(`[Notification Error - Feedback Resend Pending] ${err.message}`)
      })
    } else if (finalStatus === 'aprovado') {
      await Promise.all([
        enqueueNotification({
          userId: updated.toUserId,
          type: 'feedback_received',
          title: 'Novo feedback recebido! 🎉',
          message: `${senderName} enviou um feedback de ${typeLabel} para você.`,
          data: { feedbackId: updated.id, type: updated.type },
        }),
        FeedbackIntelligenceService.processAndPersist(updated.id),
      ]).catch((err) => {
        fastify.log.error(`[Notification Error - Feedback Resend Approved] ${err.message}`)
      })
    }

    return reply.send({ data: updated })
  })

  // ─── PATCH /feedbacks/requests/:id/decline — recusar solicitação ─────────────
  fastify.patch('/requests/:id/decline', {
    preHandler: [authenticate],
    schema: { tags: ['Feedbacks'], summary: 'Decline a feedback request' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const req = await prisma.feedbackRequest.findUnique({ where: { id } })
    if (!req) throw new NotFoundError('FeedbackRequest', id)
    if (req.toUserId !== request.user.id) throw new ForbiddenError()
    if (req.status !== 'pending') throw new ForbiddenError('Esta solicitação já foi processada')

    const updated = await prisma.feedbackRequest.update({ where: { id }, data: { status: 'declined' } })

    await enqueueNotification({
      userId: req.fromUserId,
      type: 'feedback_request_declined',
      title: 'Solicitação de feedback recusada',
      message: `Sua solicitação de feedback não foi atendida desta vez.`,
      data: { requestId: id },
    }).catch((err) => {
      fastify.log.error(`[Notification Error - Request Declined] ${err.message}`)
    })

    return reply.send({ data: updated })
  })
}

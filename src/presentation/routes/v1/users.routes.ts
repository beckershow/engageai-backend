import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { hashPassword } from '../../../shared/utils/password.js'
import { NotFoundError, ConflictError, ForbiddenError } from '../../../shared/errors/app-error.js'
import { getPaginationParams, buildPaginationMeta } from '../../../shared/utils/pagination.js'

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  nome: z.string().min(2),
  cargo: z.string().min(1),
  departamento: z.string().min(1),
  role: z.enum(['super_admin', 'gestor', 'colaborador']).default('colaborador'),
  managerId: z.string().optional(),
  avatar: z.string().optional(),
  bio: z.string().optional(),
})

const UpdateUserSchema = z.object({
  nome: z.string().min(2).optional(),
  cargo: z.string().min(1).optional(),
  departamento: z.string().min(1).optional(),
  avatar: z.string().optional(),
  bio: z.string().optional(),
  managerId: z.string().nullable().optional(),
  telefone: z.string().optional(),
  localizacao: z.string().optional(),
  hiredAt: z.string().datetime().optional(),
})

const NotificationPrefSchema = z.object({
  email: z.boolean().optional(),
  push: z.boolean().optional(),
  humor: z.boolean().optional(),
  pesquisas: z.boolean().optional(),
  recompensas: z.boolean().optional(),
  treinamentos: z.boolean().optional(),
  feedbacks: z.boolean().optional(),
})

const UpdatePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})

export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  const authHooks = { preHandler: [authenticate] }

  // GET /users - list all users (gestor+)
  fastify.get('/', {
    ...authHooks,
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Users'], summary: 'List all users' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
      role: z.enum(['super_admin', 'gestor', 'colaborador']).optional(),
      departamento: z.string().optional(),
      search: z.string().optional(),
    }).parse(request.query)

    const { skip, take, page, limit } = getPaginationParams(query)

    const where = {
      isActive: true,
      ...(query.role && { role: query.role }),
      ...(query.departamento && { departamento: query.departamento }),
      ...(query.search && {
        OR: [
          { nome: { contains: query.search, mode: 'insensitive' as const } },
          { email: { contains: query.search, mode: 'insensitive' as const } },
          { cargo: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }),
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        select: {
          id: true, email: true, nome: true, cargo: true, departamento: true,
          role: true, nivel: true, xp: true, estrelas: true, avatar: true, managerId: true,
          _count: { select: { team: true } },
        },
        orderBy: { xp: 'desc' },
      }),
      prisma.user.count({ where }),
    ])

    return reply.send({
      data: users,
      meta: buildPaginationMeta(total, page, limit),
    })
  })

  // GET /users/:id
  fastify.get('/:id', {
    ...authHooks,
    schema: { tags: ['Users'], summary: 'Get user by ID' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, nome: true, cargo: true, departamento: true,
        role: true, nivel: true, xp: true, xpProximo: true, estrelas: true,
        avatar: true, bio: true, telefone: true, localizacao: true, hiredAt: true,
        managerId: true, createdAt: true,
        manager: { select: { id: true, nome: true, cargo: true, avatar: true } },
        _count: { select: { team: true } },
      },
    })

    if (!user) throw new NotFoundError('User', id)
    return reply.send({ data: user })
  })

  // POST /users (super_admin only)
  fastify.post('/', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Users'], summary: 'Create user (super_admin)' },
  }, async (request, reply) => {
    const body = CreateUserSchema.parse(request.body)

    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } })
    if (existing) throw new ConflictError(`Email ${body.email} already in use`)

    const passwordHash = await hashPassword(body.password)
    const user = await prisma.user.create({
      data: {
        ...body,
        email: body.email.toLowerCase(),
        passwordHash,
        password: undefined,
      } as any,
    })

    return reply.code(201).send({ data: { id: user.id, email: user.email, nome: user.nome, role: user.role } })
  })

  // PUT /users/:id
  fastify.put('/:id', {
    ...authHooks,
    schema: { tags: ['Users'], summary: 'Update user' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const body = UpdateUserSchema.parse(request.body)

    // Users can only update themselves; gestor+ can update their team; super_admin can update anyone
    const isSelf = request.user.id === id
    const isSuperAdmin = request.user.role === 'super_admin'

    if (!isSelf && !isSuperAdmin) {
      // Gestores can only update their direct reports
      if (request.user.role === 'gestor') {
        const target = await prisma.user.findUnique({ where: { id } })
        if (!target || target.managerId !== request.user.id) {
          throw new ForbiddenError('Cannot update this user')
        }
      } else {
        throw new ForbiddenError('Cannot update this user')
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: body,
      select: {
        id: true, email: true, nome: true, cargo: true, departamento: true,
        role: true, nivel: true, xp: true, xpProximo: true, estrelas: true,
        avatar: true, bio: true, telefone: true, localizacao: true, hiredAt: true,
      },
    })

    return reply.send({ data: user })
  })

  // DELETE /users/:id (super_admin - soft delete)
  fastify.delete('/:id', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Users'], summary: 'Deactivate user (super_admin)' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    await prisma.user.update({ where: { id }, data: { isActive: false } })
    return reply.code(204).send()
  })

  // GET /users/:id/team (gestor+)
  fastify.get('/:id/team', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Users'], summary: 'Get team of a manager' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    // Gestores can only see their own team
    if (request.user.role === 'gestor' && request.user.id !== id) {
      throw new ForbiddenError('Can only view your own team')
    }

    const team = await prisma.user.findMany({
      where: { managerId: id, isActive: true },
      select: {
        id: true, nome: true, cargo: true, departamento: true,
        nivel: true, xp: true, estrelas: true, avatar: true, role: true,
      },
      orderBy: { xp: 'desc' },
    })

    return reply.send({ data: team })
  })

  // GET /users/:id/stats
  fastify.get('/:id/stats', {
    ...authHooks,
    schema: { tags: ['Users'], summary: 'Get user stats' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const [
      user,
      moodEntries,
      courseProgress,
      feedbacksSent,
      feedbacksReceived,
      surveyResponses,
      eventParticipations,
      trilhasCompletadas,
      allCourseProgress,
      engagementTracking,
    ] = await Promise.all([
      prisma.user.findUnique({ where: { id } }),
      prisma.moodEntry.count({ where: { userId: id } }),
      prisma.courseProgress.count({ where: { userId: id, completedAt: { not: null } } }),
      prisma.feedback.count({ where: { fromUserId: id } }),
      prisma.feedback.count({ where: { toUserId: id } }),
      prisma.surveyResponse.count({ where: { userId: id } }),
      prisma.eventParticipation.count({ where: { userId: id, attended: true } }),
      prisma.engajamentoParticipant.count({ where: { userId: id, status: 'completed' } }),
      prisma.courseProgress.findMany({ where: { userId: id }, select: { completedLessons: true } }),
      prisma.engagementTracking.findUnique({ where: { userId: id }, select: { dailyAccess: true } }),
    ])

    if (!user) throw new NotFoundError('User', id)

    const modulosFinalizados = allCourseProgress.reduce((sum, cp) => sum + cp.completedLessons.length, 0)
    const diasEngajamento = engagementTracking?.dailyAccess?.length ?? 0

    return reply.send({
      data: {
        nivel: user.nivel,
        xp: user.xp,
        xpProximo: user.xpProximo,
        estrelas: user.estrelas,
        moodEntries,
        coursesCompleted: courseProgress,
        feedbacksSent,
        feedbacksReceived,
        surveyResponses,
        eventsAttended: eventParticipations,
        trilhasCompletadas,
        modulosFinalizados,
        diasEngajamento,
      },
    })
  })

  // GET /users/:id/xp-history
  fastify.get('/:id/xp-history', {
    ...authHooks,
    schema: { tags: ['Users'], summary: 'Get XP history by month (last 6 months)' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    const logs = await prisma.auditLog.findMany({
      where: {
        actorId: id,
        action: { startsWith: 'gamification.' },
        createdAt: { gte: sixMonthsAgo },
      },
      select: { createdAt: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    })

    const byMonth: Record<string, number> = {}
    for (const log of logs) {
      const key = log.createdAt.toISOString().slice(0, 7)
      const meta = log.metadata as { xp?: number } | null
      byMonth[key] = (byMonth[key] ?? 0) + (meta?.xp ?? 0)
    }

    const result = Object.entries(byMonth).map(([mes, xp]) => ({
      mes,
      xp,
      label: new Date(mes + '-01T12:00:00Z').toLocaleString('pt-BR', { month: 'short' }),
    }))

    return reply.send({ data: result })
  })

  // GET /users/:id/notification-preferences
  fastify.get('/:id/notification-preferences', {
    ...authHooks,
    schema: { tags: ['Users'], summary: 'Get notification preferences' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    if (request.user.id !== id && request.user.role !== 'super_admin') {
      throw new ForbiddenError('Cannot access preferences of another user')
    }

    const pref = await prisma.notificationPreference.upsert({
      where: { userId: id },
      create: { userId: id },
      update: {},
    })

    return reply.send({ data: pref })
  })

  // PUT /users/:id/notification-preferences
  fastify.put('/:id/notification-preferences', {
    ...authHooks,
    schema: { tags: ['Users'], summary: 'Update notification preferences' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    if (request.user.id !== id && request.user.role !== 'super_admin') {
      throw new ForbiddenError('Cannot update preferences of another user')
    }

    const body = NotificationPrefSchema.parse(request.body)

    const pref = await prisma.notificationPreference.upsert({
      where: { userId: id },
      create: { userId: id, ...body },
      update: body,
    })

    return reply.send({ data: pref })
  })

  // POST /users/:id/change-password
  fastify.post('/:id/change-password', {
    ...authHooks,
    schema: { tags: ['Users'], summary: 'Change user password' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    if (request.user.id !== id && request.user.role !== 'super_admin') {
      throw new ForbiddenError('Cannot change password for another user')
    }

    const { currentPassword, newPassword } = UpdatePasswordSchema.parse(request.body)

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundError('User', id)

    const { comparePassword } = await import('../../../shared/utils/password.js')
    const valid = await comparePassword(currentPassword, user.passwordHash)
    if (!valid) throw new ForbiddenError('Current password is incorrect')

    const newHash = await hashPassword(newPassword)
    await prisma.user.update({ where: { id }, data: { passwordHash: newHash } })

    return reply.send({ message: 'Password updated successfully' })
  })
}

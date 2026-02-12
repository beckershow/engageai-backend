import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { awardXpUseCase, XP_REWARDS, STAR_REWARDS } from '../../../application/gamification/award-xp.usecase.js'
import { NotFoundError, ConflictError } from '../../../shared/errors/app-error.js'
import { getPaginationParams, buildPaginationMeta } from '../../../shared/utils/pagination.js'

export async function eventsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /events
  fastify.get('/', {
    preHandler: [authenticate],
    schema: { tags: ['Events'], summary: 'List events' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
      upcoming: z.coerce.boolean().optional(),
    }).parse(request.query)

    const { skip, take, page, limit } = getPaginationParams(query)
    const where: any = { isActive: true }
    if (query.upcoming) where.date = { gte: new Date() }

    const [events, total] = await Promise.all([
      prisma.evento.findMany({
        where,
        skip,
        take,
        orderBy: { date: 'asc' },
        include: {
          creator: { select: { id: true, nome: true } },
          _count: { select: { participations: true } },
        },
      }),
      prisma.evento.count({ where }),
    ])

    const eventIds = events.map(e => e.id)
    const userParts = await prisma.eventParticipation.findMany({
      where: { eventoId: { in: eventIds }, userId: request.user.id },
      select: { eventoId: true, attended: true },
    })
    const partMap = new Map(userParts.map(p => [p.eventoId, p]))

    return reply.send({
      data: events.map(e => ({ ...e, userParticipation: partMap.get(e.id) ?? null })),
      meta: buildPaginationMeta(total, page, limit),
    })
  })

  // GET /events/:id
  fastify.get('/:id', {
    preHandler: [authenticate],
    schema: { tags: ['Events'], summary: 'Get event by ID' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const event = await prisma.evento.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, nome: true } },
        participations: {
          select: {
            id: true, attended: true, registeredAt: true,
            user: { select: { id: true, nome: true, avatar: true, departamento: true } },
          },
        },
        _count: { select: { participations: true } },
      },
    })
    if (!event) throw new NotFoundError('Event', id)
    return reply.send({ data: event })
  })

  // POST /events (gestor+)
  fastify.post('/', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Events'], summary: 'Create event (gestor+)' },
  }, async (request, reply) => {
    const body = z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      date: z.string().datetime(),
      endDate: z.string().datetime().optional(),
      location: z.string().optional(),
      isOnline: z.boolean().default(false),
      meetingUrl: z.string().url().optional(),
      rewardXP: z.number().int().min(0).default(80),
      maxParticipants: z.number().int().optional(),
      evidenceType: z.enum(['foto', 'video', 'documento', 'link', 'checkin']).optional(),
    }).parse(request.body)

    const event = await prisma.evento.create({
      data: {
        ...body,
        date: new Date(body.date),
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        creatorId: request.user.id,
      },
    })

    return reply.code(201).send({ data: event })
  })

  // POST /events/:id/register - register for event
  fastify.post('/:id/register', {
    preHandler: [authenticate],
    schema: { tags: ['Events'], summary: 'Register for event' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const event = await prisma.evento.findUnique({ where: { id } })
    if (!event) throw new NotFoundError('Event', id)

    const existing = await prisma.eventParticipation.findUnique({
      where: { eventoId_userId: { eventoId: id, userId: request.user.id } },
    })
    if (existing) throw new ConflictError('Already registered for this event')

    if (event.maxParticipants) {
      const count = await prisma.eventParticipation.count({ where: { eventoId: id } })
      if (count >= event.maxParticipants) {
        throw new ConflictError('Event is full')
      }
    }

    const participation = await prisma.eventParticipation.create({
      data: { eventoId: id, userId: request.user.id },
    })

    return reply.code(201).send({ data: participation })
  })

  // POST /events/:id/participate - mark attendance with evidence
  fastify.post('/:id/participate', {
    preHandler: [authenticate],
    schema: { tags: ['Events'], summary: 'Submit event participation evidence' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const body = z.object({
      evidenceUrl: z.string().optional(),
      evidenceType: z.enum(['foto', 'video', 'documento', 'link', 'checkin']).optional(),
    }).parse(request.body)

    const event = await prisma.evento.findUnique({ where: { id } })
    if (!event) throw new NotFoundError('Event', id)

    const participation = await prisma.eventParticipation.upsert({
      where: { eventoId_userId: { eventoId: id, userId: request.user.id } },
      create: {
        eventoId: id,
        userId: request.user.id,
        attended: true,
        ...body,
        xpGranted: event.rewardXP,
        xpGrantedAt: new Date(),
      },
      update: {
        attended: true,
        ...body,
        xpGranted: event.rewardXP,
        xpGrantedAt: new Date(),
      },
    })

    await awardXpUseCase({
      userId: request.user.id,
      userRole: request.user.role,
      action: 'participar_evento',
      xp: event.rewardXP || XP_REWARDS.participar_evento,
      stars: STAR_REWARDS.participar_evento,
      context: { eventId: id },
    })

    return reply.send({ data: participation })
  })

  // DELETE /events/:id (admin)
  fastify.delete('/:id', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Events'], summary: 'Delete event' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    await prisma.evento.update({ where: { id }, data: { isActive: false } })
    return reply.code(204).send()
  })
}

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { getPaginationParams, buildPaginationMeta } from '../../../shared/utils/pagination.js'

export async function notificationsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /notifications
  fastify.get('/', {
    preHandler: [authenticate],
    schema: { tags: ['Notifications'], summary: 'Get notifications' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
      status: z.enum(['unread', 'read']).optional(),
    }).parse(request.query)

    const { skip, take, page, limit } = getPaginationParams(query)
    const where: any = { userId: request.user.id }
    if (query.status) where.status = query.status

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: request.user.id, status: 'unread' } }),
    ])

    return reply.send({
      data: notifications,
      meta: { ...buildPaginationMeta(total, page, limit), unreadCount },
    })
  })

  // PATCH /notifications/:id/read
  fastify.patch('/:id/read', {
    preHandler: [authenticate],
    schema: { tags: ['Notifications'], summary: 'Mark notification as read' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    await prisma.notification.updateMany({
      where: { id, userId: request.user.id },
      data: { status: 'read', readAt: new Date() },
    })

    return reply.send({ message: 'Notification marked as read' })
  })

  // PATCH /notifications/read-all
  fastify.patch('/read-all', {
    preHandler: [authenticate],
    schema: { tags: ['Notifications'], summary: 'Mark all notifications as read' },
  }, async (request, reply) => {
    await prisma.notification.updateMany({
      where: { userId: request.user.id, status: 'unread' },
      data: { status: 'read', readAt: new Date() },
    })

    return reply.send({ message: 'All notifications marked as read' })
  })
}

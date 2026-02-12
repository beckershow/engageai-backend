import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { NotFoundError, ForbiddenError } from '../../../shared/errors/app-error.js'
import { getPaginationParams, buildPaginationMeta } from '../../../shared/utils/pagination.js'
import { enqueueNotification } from '../../../infrastructure/queue/bullmq.client.js'

export async function rewardsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /rewards
  fastify.get('/', {
    preHandler: [authenticate],
    schema: { tags: ['Rewards'], summary: 'List rewards' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
    }).parse(request.query)

    const { skip, take, page, limit } = getPaginationParams(query)

    const [rewards, total] = await Promise.all([
      prisma.reward.findMany({
        where: { isActive: true },
        skip,
        take,
        orderBy: { custo: 'asc' },
        include: {
          _count: { select: { redemptions: true } },
        },
      }),
      prisma.reward.count({ where: { isActive: true } }),
    ])

    return reply.send({ data: rewards, meta: buildPaginationMeta(total, page, limit) })
  })

  // POST /rewards (super_admin)
  fastify.post('/', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Rewards'], summary: 'Create reward (super_admin)' },
  }, async (request, reply) => {
    const body = z.object({
      nome: z.string().min(1),
      descricao: z.string().optional(),
      custo: z.number().int().min(1),
      quantidade: z.number().int().min(1).optional(),
      imageUrl: z.string().url().optional(),
      category: z.string().optional(),
    }).parse(request.body)

    const reward = await prisma.reward.create({ data: body })
    return reply.code(201).send({ data: reward })
  })

  // PUT /rewards/:id (super_admin)
  fastify.put('/:id', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Rewards'], summary: 'Update reward' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const body = z.object({
      nome: z.string().optional(),
      descricao: z.string().optional(),
      custo: z.number().int().min(1).optional(),
      quantidade: z.number().int().min(1).nullable().optional(),
      isActive: z.boolean().optional(),
    }).parse(request.body)

    const reward = await prisma.reward.update({ where: { id }, data: body })
    return reply.send({ data: reward })
  })

  // POST /rewards/:id/redeem - redeem reward
  fastify.post('/:id/redeem', {
    preHandler: [authenticate],
    schema: { tags: ['Rewards'], summary: 'Redeem reward (costs stars)' },
  }, async (request, reply) => {
    if (request.user.role !== 'colaborador') {
      throw new ForbiddenError('Only colaboradores can redeem rewards')
    }

    const { id } = z.object({ id: z.string() }).parse(request.params)

    const reward = await prisma.reward.findUnique({ where: { id } })
    if (!reward || !reward.isActive) throw new NotFoundError('Reward', id)

    // Check stock
    if (reward.quantidade !== null) {
      const redeemed = await prisma.rewardRedemption.count({ where: { rewardId: id } })
      if (redeemed >= reward.quantidade) {
        throw new ForbiddenError('Reward out of stock')
      }
    }

    // Check user stars
    const user = await prisma.user.findUnique({ where: { id: request.user.id } })
    if (!user) throw new NotFoundError('User', request.user.id)
    if (user.estrelas < reward.custo) {
      throw new ForbiddenError(`Insufficient stars. Need ${reward.custo}, have ${user.estrelas}`)
    }

    // Deduct stars and create redemption in a transaction
    const [redemption] = await prisma.$transaction([
      prisma.rewardRedemption.create({
        data: {
          rewardId: id,
          userId: request.user.id,
          starsCost: reward.custo,
        },
      }),
      prisma.user.update({
        where: { id: request.user.id },
        data: { estrelas: { decrement: reward.custo } },
      }),
    ])

    await enqueueNotification({
      userId: request.user.id,
      type: 'reward_redeemed',
      title: 'Recompensa resgatada!',
      message: `Você resgatou "${reward.nome}" por ${reward.custo} estrelas.`,
      data: { rewardId: id, rewardName: reward.nome, starsCost: reward.custo },
    })

    return reply.code(201).send({ data: { redemptionId: redemption.id, starsCost: reward.custo } })
  })

  // GET /rewards/redemptions - my redemptions
  fastify.get('/redemptions', {
    preHandler: [authenticate],
    schema: { tags: ['Rewards'], summary: 'Get my redemptions' },
  }, async (request, reply) => {
    const redemptions = await prisma.rewardRedemption.findMany({
      where: { userId: request.user.id },
      orderBy: { redeemedAt: 'desc' },
      include: {
        reward: { select: { id: true, nome: true, descricao: true, imageUrl: true } },
      },
    })
    return reply.send({ data: redemptions })
  })
}

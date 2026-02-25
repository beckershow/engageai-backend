import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize, isSuperAdmin } from '../../middlewares/authorize.js'
import { enqueueNotification } from '../../../infrastructure/queue/bullmq.client.js'
import { AppError } from '../../../shared/errors/app-error.js'

// ─── Helper de Auditoria ─────────────────────────────────────────────────────

async function createAuditLog(
  data: { itemId?: string; action: string; performedById: string; metadata?: Record<string, unknown> },
) {
  await prisma.storeAuditLog.create({ data }).catch(() => {})
}

export async function storeRoutes(fastify: FastifyInstance): Promise<void> {

  // ─── CATEGORIAS ────────────────────────────────────────────────────────────

  // GET /store/categories — listar categorias (qualquer autenticado)
  fastify.get('/categories', {
    preHandler: [authenticate],
    schema: { tags: ['Store'], summary: 'List store categories' },
  }, async (_request, reply) => {
    const categories = await prisma.storeItemCategory.findMany({
      orderBy: { name: 'asc' },
    })
    return reply.send({ data: categories })
  })

  // POST /store/categories — criar categoria (super_admin)
  fastify.post('/categories', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Store'], summary: 'Create category (super_admin)' },
  }, async (request, reply) => {
    const { name } = z.object({ name: z.string().min(1).max(100) }).parse(request.body)
    const category = await prisma.storeItemCategory.create({ data: { name } })
    return reply.code(201).send({ data: category })
  })

  // ─── ITENS (SUPER ADMIN) ────────────────────────────────────────────────────

  // GET /store/items — listar todos os itens (super_admin)
  fastify.get('/items', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Store'], summary: 'List all store items (super_admin)' },
  }, async (request, reply) => {
    const { status, page = '1', limit = '50' } = request.query as {
      status?: string; page?: string; limit?: string
    }
    const skip = (Number(page) - 1) * Number(limit)

    const where = status ? { status: status as any } : {}

    const [items, total] = await Promise.all([
      prisma.storeItem.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          category: true,
          createdBy: { select: { id: true, nome: true } },
          managerVisibility: {
            include: { manager: { select: { id: true, nome: true } } },
          },
          _count: { select: { redemptions: true } },
        },
      }),
      prisma.storeItem.count({ where }),
    ])

    return reply.send({
      data: items,
      meta: { page: Number(page), limit: Number(limit), total },
    })
  })

  // POST /store/items — criar item (super_admin)
  fastify.post('/items', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Store'], summary: 'Create store item (super_admin)' },
  }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1).max(200),
      categoryId: z.string().cuid(),
      description: z.string().min(1).max(2000),
      costStars: z.number().int().min(0).default(0),
      quantity: z.number().int().positive().nullable().default(null),
      imageUrl: z.string().nullable().default(null),
      internalNotes: z.string().max(1000).nullable().default(null),
      status: z.enum(['draft', 'created']).default('draft'),
      managerIds: z.array(z.string()).default([]), // vazio = todos os gestores
    }).parse(request.body)

    const item = await prisma.storeItem.create({
      data: {
        name: body.name,
        categoryId: body.categoryId,
        description: body.description,
        costStars: body.costStars,
        quantity: body.quantity,
        imageUrl: body.imageUrl,
        internalNotes: body.internalNotes,
        status: body.status,
        createdById: request.user.id,
        ...(body.managerIds.length > 0 && {
          managerVisibility: {
            create: body.managerIds.map(managerId => ({ managerId })),
          },
        }),
      },
      include: {
        category: true,
        managerVisibility: { include: { manager: { select: { id: true, nome: true } } } },
      },
    })

    await createAuditLog({ itemId: item.id, action: 'item_created', performedById: request.user.id, metadata: { name: item.name } })

    return reply.code(201).send({ data: item })
  })

  // PATCH /store/items/:id — editar item (super_admin)
  fastify.patch('/items/:id', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Store'], summary: 'Update store item (super_admin)' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const body = z.object({
      name: z.string().min(1).max(200).optional(),
      categoryId: z.string().cuid().optional(),
      description: z.string().min(1).max(2000).optional(),
      costStars: z.number().int().min(0).optional(),
      quantity: z.number().int().positive().nullable().optional(),
      imageUrl: z.string().nullable().optional(),
      internalNotes: z.string().max(1000).nullable().optional(),
      managerIds: z.array(z.string()).optional(),
    }).parse(request.body)

    const existing = await prisma.storeItem.findUnique({ where: { id } })
    if (!existing) throw new AppError('Item não encontrado', 404, 'NOT_FOUND')

    // Atualiza visibilidade de gestores se fornecido
    if (body.managerIds !== undefined) {
      await prisma.storeItemManagerVisibility.deleteMany({ where: { itemId: id } })
      if (body.managerIds.length > 0) {
        await prisma.storeItemManagerVisibility.createMany({
          data: body.managerIds.map(managerId => ({ itemId: id, managerId })),
        })
      }
    }

    const { managerIds: _, ...updateData } = body
    const item = await prisma.storeItem.update({
      where: { id },
      data: updateData,
      include: {
        category: true,
        managerVisibility: { include: { manager: { select: { id: true, nome: true } } } },
      },
    })

    await createAuditLog({ itemId: id, action: 'item_updated', performedById: request.user.id, metadata: { name: item.name } })

    return reply.send({ data: item })
  })

  // DELETE /store/items/:id — remover item (super_admin)
  fastify.delete('/items/:id', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Store'], summary: 'Delete store item (super_admin)' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await prisma.storeItem.findUnique({ where: { id } })
    if (!existing) throw new AppError('Item não encontrado', 404, 'NOT_FOUND')

    await createAuditLog({ itemId: id, action: 'item_deleted', performedById: request.user.id, metadata: { name: existing.name } })
    await prisma.storeItem.delete({ where: { id } })
    return reply.code(204).send()
  })

  // PATCH /store/items/:id/status — ativar/desativar/promover item (super_admin)
  fastify.patch('/items/:id/status', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Store'], summary: 'Change store item status (super_admin)' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { status } = z.object({
      status: z.enum(['draft', 'created', 'active', 'inactive']),
    }).parse(request.body)

    const existing = await prisma.storeItem.findUnique({
      where: { id },
      include: { managerVisibility: true },
    })
    if (!existing) throw new AppError('Item não encontrado', 404, 'NOT_FOUND')

    const item = await prisma.storeItem.update({
      where: { id },
      data: { status },
      include: { category: true },
    })

    // Ao ativar: criar StoreManagerInventory e notificar gestores
    if (status === 'active' && existing.status !== 'active') {
      // Buscar gestores que devem receber o item
      let gestorIds: string[]

      if (existing.managerVisibility.length === 0) {
        // Item disponível para todos os gestores
        const gestores = await prisma.user.findMany({
          where: { role: 'gestor', isActive: true },
          select: { id: true },
        })
        gestorIds = gestores.map(g => g.id)
      } else {
        gestorIds = existing.managerVisibility.map(mv => mv.managerId)
      }

      // Criar StoreManagerInventory para cada gestor elegível (upsert)
      if (gestorIds.length > 0) {
        await prisma.storeManagerInventory.createMany({
          data: gestorIds.map(managerId => ({
            itemId: id,
            managerId,
            status: 'in_stock' as const,
          })),
          skipDuplicates: true,
        })
      }

      // Enviar notificação para cada gestor
      await Promise.all(
        gestorIds.map(gestorId =>
          enqueueNotification({
            userId: gestorId,
            type: 'store_item_sent_to_manager',
            title: '🛍️ Novo item no seu estoque!',
            message: `"${item.name}" foi ativado e está disponível no seu estoque da lojinha.`,
            data: { itemId: item.id, itemName: item.name },
          }).catch(() => {})
        )
      )

      await createAuditLog({ itemId: id, action: 'item_sent_to_manager', performedById: request.user.id, metadata: { name: item.name, gestorCount: gestorIds.length } })
    }

    // Ao desativar
    if (status === 'inactive' && existing.status !== 'inactive') {
      await createAuditLog({ itemId: id, action: 'item_deactivated', performedById: request.user.id, metadata: { name: item.name } })
    }

    // Ao criar (draft → created): notificação interna (sem notif para gestores ainda)
    if (status === 'created' && existing.status === 'draft') {
      await enqueueNotification({
        userId: request.user.id,
        type: 'store_item_created',
        title: '✅ Item criado com sucesso',
        message: `"${item.name}" foi criado e está aguardando ativação.`,
        data: { itemId: item.id },
      }).catch(() => {})
    }

    return reply.send({ data: item })
  })

  // ─── INVENTÁRIO DO GESTOR ───────────────────────────────────────────────────

  // GET /store/manager-inventory — inventário do gestor logado
  fastify.get('/manager-inventory', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Store'], summary: 'Get manager inventory' },
  }, async (request, reply) => {
    const managerId = request.user.id

    const inventory = await prisma.storeManagerInventory.findMany({
      where: { managerId },
      include: {
        item: {
          include: {
            category: true,
            _count: { select: { redemptions: true } },
          },
        },
      },
      orderBy: { item: { createdAt: 'desc' } },
    })

    return reply.send({ data: inventory })
  })

  // PATCH /store/manager-inventory/:itemId — gestor ativa/desativa item para time
  fastify.patch('/manager-inventory/:itemId', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Store'], summary: 'Set manager inventory item status' },
  }, async (request, reply) => {
    const { itemId } = request.params as { itemId: string }
    const managerId = request.user.id

    const { status } = z.object({
      status: z.enum(['active_for_team', 'inactive_for_team']),
    }).parse(request.body)

    const inventoryRecord = await prisma.storeManagerInventory.findUnique({
      where: { itemId_managerId: { itemId, managerId } },
      include: { item: true },
    })
    if (!inventoryRecord) throw new AppError('Item não encontrado no inventário', 404, 'NOT_FOUND')

    const updated = await prisma.storeManagerInventory.update({
      where: { itemId_managerId: { itemId, managerId } },
      data: {
        status,
        activatedAt: status === 'active_for_team' ? new Date() : null,
      },
    })

    if (status === 'active_for_team') {
      // Criar visibilidade para todo o time
      await prisma.storeItemTeamVisibility.deleteMany({ where: { itemId, managerId } })
      await prisma.storeItemTeamVisibility.create({
        data: { itemId, managerId, teamScope: 'all', userId: null },
      })

      // Notificar todos os colaboradores do time
      const team = await prisma.user.findMany({
        where: { managerId, isActive: true, role: 'colaborador' },
        select: { id: true },
      })

      await Promise.all(
        team.map(member =>
          enqueueNotification({
            userId: member.id,
            type: 'store_item_available_to_team',
            title: '🎁 Novo item disponível na Lojinha!',
            message: `"${inventoryRecord.item.name}" já está disponível para resgate na lojinha!`,
            data: { itemId, itemName: inventoryRecord.item.name },
          }).catch(() => {})
        )
      )

      await createAuditLog({ itemId, action: 'manager_item_activated', performedById: managerId, metadata: { itemName: inventoryRecord.item.name } })
    } else {
      // Remover visibilidade
      await prisma.storeItemTeamVisibility.deleteMany({ where: { itemId, managerId } })
      await createAuditLog({ itemId, action: 'manager_item_deactivated', performedById: managerId, metadata: { itemName: inventoryRecord.item.name } })
    }

    return reply.send({ data: updated })
  })

  // ─── ITENS (GESTOR - compatibilidade) ────────────────────────────────────────

  // GET /store/manager-items — itens ativos disponíveis para o gestor logado (mantido para compatibilidade)
  fastify.get('/manager-items', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Store'], summary: "Get active items available to this manager" },
  }, async (request, reply) => {
    const managerId = request.user.id

    // Itens com managerVisibility vazia (todos) OU com o gestor listado
    const items = await prisma.storeItem.findMany({
      where: {
        status: 'active',
        OR: [
          { managerVisibility: { none: {} } },
          { managerVisibility: { some: { managerId } } },
        ],
      },
      include: {
        category: true,
        teamVisibility: {
          where: { managerId },
          include: { user: { select: { id: true, nome: true, avatar: true } } },
        },
        _count: { select: { redemptions: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ data: items })
  })

  // PATCH /store/items/:id/team-visibility — gestor define quem do time pode ver o item
  fastify.patch('/items/:id/team-visibility', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Store'], summary: "Set team visibility for a store item (gestor)" },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const managerId = request.user.id

    const { scope, userIds } = z.object({
      scope: z.enum(['all', 'specific']),
      userIds: z.array(z.string()).optional().default([]),
    }).parse(request.body)

    // Verificar se o gestor tem acesso ao item
    const item = await prisma.storeItem.findFirst({
      where: {
        id,
        status: 'active',
        OR: [
          { managerVisibility: { none: {} } },
          { managerVisibility: { some: { managerId } } },
        ],
      },
    })
    if (!item) throw new AppError('Item não encontrado ou sem permissão de acesso', 404, 'NOT_FOUND')

    // Remover visibilidade anterior deste gestor
    await prisma.storeItemTeamVisibility.deleteMany({ where: { itemId: id, managerId } })

    if (scope === 'all') {
      // Um registro com scope=all significa disponível para todo o time
      await prisma.storeItemTeamVisibility.create({
        data: { itemId: id, managerId, teamScope: 'all', userId: null },
      })

      // Notificar todos os colaboradores do time
      const team = await prisma.user.findMany({
        where: { managerId, isActive: true, role: 'colaborador' },
        select: { id: true },
      })

      await Promise.all(
        team.map(member =>
          enqueueNotification({
            userId: member.id,
            type: 'store_item_available_to_team',
            title: '🎁 Novo item disponível na Lojinha!',
            message: `"${item.name}" já está disponível para resgate na lojinha!`,
            data: { itemId: item.id, itemName: item.name },
          }).catch(() => {})
        )
      )
    } else if (scope === 'specific' && userIds.length > 0) {
      // Um registro por usuário específico
      await prisma.storeItemTeamVisibility.createMany({
        data: userIds.map(userId => ({
          itemId: id,
          managerId,
          userId,
          teamScope: 'specific',
        })),
      })

      // Notificar usuários específicos
      await Promise.all(
        userIds.map(userId =>
          enqueueNotification({
            userId,
            type: 'store_item_available_to_team',
            title: '🎁 Novo item disponível na Lojinha!',
            message: `"${item.name}" foi disponibilizado para você na lojinha!`,
            data: { itemId: item.id, itemName: item.name },
          }).catch(() => {})
        )
      )
    }

    const updated = await prisma.storeItemTeamVisibility.findMany({
      where: { itemId: id, managerId },
      include: { user: { select: { id: true, nome: true } } },
    })

    return reply.send({ data: updated })
  })

  // ─── ITENS (COLABORADOR) ──────────────────────────────────────────────────

  // GET /store/available — itens disponíveis para o colaborador logado
  fastify.get('/available', {
    preHandler: [authenticate],
    schema: { tags: ['Store'], summary: "Get store items available to the authenticated user" },
  }, async (request, reply) => {
    const userId = request.user.id
    const managerId = request.user.managerId

    if (!managerId) {
      return reply.send({ data: [] })
    }

    // Buscar itens onde existe visibilidade de time para o colaborador:
    // teamScope = 'all' (qualquer membro do time) OU userId = colaborador específico
    const items = await prisma.storeItem.findMany({
      where: {
        status: 'active',
        teamVisibility: {
          some: {
            managerId,
            OR: [
              { teamScope: 'all' },
              { userId },
            ],
          },
        },
        AND: [
          {
            OR: [
              { quantity: null }, // ilimitado
              { quantity: { gt: 0 } }, // com estoque
            ],
          },
        ],
      },
      include: {
        category: true,
        _count: { select: { redemptions: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ data: items })
  })

  // POST /store/items/:id/redeem — resgatar item
  fastify.post('/items/:id/redeem', {
    preHandler: [authenticate],
    schema: { tags: ['Store'], summary: 'Redeem a store item' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const userId = request.user.id
    const managerId = request.user.managerId

    const item = await prisma.storeItem.findUnique({ where: { id } })
    if (!item || item.status !== 'active') {
      throw new AppError('Item não encontrado ou indisponível', 404, 'NOT_FOUND')
    }

    // Verificar estoque
    if (item.quantity !== null && item.quantity <= 0) {
      throw new AppError('Item esgotado', 409, 'OUT_OF_STOCK')
    }

    // Verificar estrelas do usuário
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { estrelas: true, nome: true },
    })
    if (!user) throw new AppError('Usuário não encontrado', 404, 'NOT_FOUND')

    if (user.estrelas < item.costStars) {
      throw new AppError(
        `Estrelas insuficientes. Você tem ${user.estrelas}⭐ e precisa de ${item.costStars}⭐.`,
        402,
        'INSUFFICIENT_STARS',
      )
    }

    // Transação: criar resgate + debitar estrelas + decrementar estoque
    const [redemption] = await prisma.$transaction([
      prisma.storeRedemption.create({
        data: { itemId: id, userId, status: 'pending' },
        include: { item: { include: { category: true } } },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { estrelas: { decrement: item.costStars } },
      }),
      ...(item.quantity !== null
        ? [prisma.storeItem.update({
            where: { id },
            data: { quantity: { decrement: 1 } },
          })]
        : []),
    ])

    // Notificar gestor sobre o resgate
    if (managerId) {
      await enqueueNotification({
        userId: managerId,
        type: 'store_item_available_to_manager',
        title: '🛍️ Resgate realizado',
        message: `${user.nome} resgatou "${item.name}" na lojinha.`,
        data: { itemId: item.id, userId, redemptionId: redemption.id },
      }).catch(() => {})
    }

    await createAuditLog({ itemId: id, action: 'item_redeemed', performedById: userId, metadata: { itemName: item.name, userId } })

    return reply.code(201).send({ data: redemption })
  })

  // GET /store/my-redemptions — resgates do usuário logado
  fastify.get('/my-redemptions', {
    preHandler: [authenticate],
    schema: { tags: ['Store'], summary: 'Get authenticated user redemptions' },
  }, async (request, reply) => {
    const redemptions = await prisma.storeRedemption.findMany({
      where: { userId: request.user.id },
      include: {
        item: { include: { category: true } },
      },
      orderBy: { redeemedAt: 'desc' },
    })
    return reply.send({ data: redemptions })
  })

  // GET /store/team-redemptions — resgates do time do gestor (gestor+)
  fastify.get('/team-redemptions', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Store'], summary: 'Get team redemptions (gestor+)' },
  }, async (request, reply) => {
    const managerId = request.user.id
    const isAdmin = isSuperAdmin(request.user.role)

    const where = isAdmin
      ? {} // super_admin vê tudo
      : { user: { managerId } } // gestor vê apenas o seu time

    const redemptions = await prisma.storeRedemption.findMany({
      where,
      include: {
        item: { include: { category: true } },
        user: { select: { id: true, nome: true, avatar: true, cargo: true } },
      },
      orderBy: { redeemedAt: 'desc' },
      take: 100,
    })

    return reply.send({ data: redemptions })
  })

  // PATCH /store/redemptions/:id/status — atualizar status do resgate (gestor+)
  fastify.patch('/redemptions/:id/status', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Store'], summary: 'Update redemption status (gestor+)' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { status } = z.object({
      status: z.enum(['pending', 'fulfilled', 'cancelled']),
    }).parse(request.body)

    const redemption = await prisma.storeRedemption.findUnique({
      where: { id },
      include: { item: true, user: { select: { id: true, nome: true } } },
    })
    if (!redemption) throw new AppError('Resgate não encontrado', 404, 'NOT_FOUND')

    const updated = await prisma.storeRedemption.update({
      where: { id },
      data: { status },
    })

    // Notificar colaborador sobre a atualização do resgate
    await enqueueNotification({
      userId: redemption.userId,
      type: 'store_item_available_to_team',
      title: status === 'fulfilled' ? '✅ Resgate confirmado!' : '❌ Resgate cancelado',
      message: status === 'fulfilled'
        ? `Seu resgate de "${redemption.item.name}" foi confirmado!`
        : `Seu resgate de "${redemption.item.name}" foi cancelado.`,
      data: { redemptionId: id, itemId: redemption.itemId },
    }).catch(() => {})

    await createAuditLog({ itemId: redemption.itemId, action: 'redemption_status_updated', performedById: request.user.id, metadata: { redemptionId: id, status } })

    return reply.send({ data: updated })
  })

  // ─── SOLICITAÇÕES DE RECOMPENSA ─────────────────────────────────────────────

  // POST /store/reward-requests — gestor solicita nova recompensa
  fastify.post('/reward-requests', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Store'], summary: 'Request a new reward (gestor)' },
  }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1).max(200),
      description: z.string().min(1).max(2000),
      category: z.string().min(1).max(100),
      estimatedStarCost: z.number().int().min(0).default(0),
      justification: z.string().min(1).max(2000),
    }).parse(request.body)

    const rewardRequest = await prisma.storeRewardRequest.create({
      data: {
        ...body,
        managerId: request.user.id,
        status: 'pending',
      },
    })

    // Notificar todos os super_admins
    const superAdmins = await prisma.user.findMany({
      where: { role: 'super_admin', isActive: true },
      select: { id: true },
    })

    await Promise.all(
      superAdmins.map(admin =>
        enqueueNotification({
          userId: admin.id,
          type: 'store_reward_requested',
          title: '📋 Solicitação de recompensa',
          message: `Um gestor solicitou a recompensa "${body.name}".`,
          data: { requestId: rewardRequest.id, name: body.name },
        }).catch(() => {})
      )
    )

    await createAuditLog({ action: 'reward_requested', performedById: request.user.id, metadata: { name: body.name, requestId: rewardRequest.id } })

    return reply.code(201).send({ data: rewardRequest })
  })

  // GET /store/reward-requests — listar solicitações
  fastify.get('/reward-requests', {
    preHandler: [authenticate],
    schema: { tags: ['Store'], summary: 'List reward requests' },
  }, async (request, reply) => {
    const isSA = isSuperAdmin(request.user.role)

    const requests = await prisma.storeRewardRequest.findMany({
      where: isSA ? {} : { managerId: request.user.id },
      include: {
        manager: { select: { id: true, nome: true } },
        reviewedBy: { select: { id: true, nome: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ data: requests })
  })

  // PATCH /store/reward-requests/:id/review — super_admin revisa solicitação
  fastify.patch('/reward-requests/:id/review', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Store'], summary: 'Review reward request (super_admin)' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const { status, reviewNote } = z.object({
      status: z.enum(['approved', 'rejected', 'converted']),
      reviewNote: z.string().max(1000).optional(),
    }).parse(request.body)

    const existing = await prisma.storeRewardRequest.findUnique({ where: { id } })
    if (!existing) throw new AppError('Solicitação não encontrada', 404, 'NOT_FOUND')

    const updated = await prisma.storeRewardRequest.update({
      where: { id },
      data: {
        status,
        reviewNote: reviewNote ?? null,
        reviewedById: request.user.id,
        reviewedAt: new Date(),
      },
      include: {
        manager: { select: { id: true, nome: true } },
      },
    })

    // Notificar o gestor
    await enqueueNotification({
      userId: existing.managerId,
      type: 'store_reward_request_reviewed',
      title: status === 'approved' ? '✅ Solicitação aprovada!' : status === 'rejected' ? '❌ Solicitação recusada' : '🔄 Solicitação convertida',
      message: `Sua solicitação "${existing.name}" foi ${status === 'approved' ? 'aprovada' : status === 'rejected' ? 'recusada' : 'convertida em item'}.`,
      data: { requestId: id, status, reviewNote },
    }).catch(() => {})

    await createAuditLog({ action: 'reward_request_reviewed', performedById: request.user.id, metadata: { requestId: id, status, name: existing.name } })

    return reply.send({ data: updated })
  })

  // ─── AUDITORIA ──────────────────────────────────────────────────────────────

  // GET /store/audit-logs — logs de auditoria (super_admin)
  fastify.get('/audit-logs', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Store'], summary: 'Get store audit logs (super_admin)' },
  }, async (request, reply) => {
    const { page = '1', limit = '50', itemId } = request.query as {
      page?: string; limit?: string; itemId?: string
    }
    const skip = (Number(page) - 1) * Number(limit)
    const where = itemId ? { itemId } : {}

    const [logs, total] = await Promise.all([
      prisma.storeAuditLog.findMany({
        where,
        include: {
          item: { select: { id: true, name: true } },
          performedBy: { select: { id: true, nome: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.storeAuditLog.count({ where }),
    ])

    return reply.send({ data: logs, meta: { page: Number(page), limit: Number(limit), total } })
  })
}

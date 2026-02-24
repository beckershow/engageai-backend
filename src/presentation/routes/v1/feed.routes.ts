import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { awardXpUseCase, XP_REWARDS, STAR_REWARDS } from '../../../application/gamification/award-xp.usecase.js'
import { enqueueNotification } from '../../../infrastructure/queue/bullmq.client.js'
import { NotFoundError, ForbiddenError } from '../../../shared/errors/app-error.js'
import { getPaginationParams, buildPaginationMeta } from '../../../shared/utils/pagination.js'

const postSelect = {
  id: true,
  content: true,
  imageUrl: true,
  videoUrl: true,
  status: true,
  isPinned: true,
  viewsCount: true,
  approvedAt: true,
  rejectedReason: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, nome: true, cargo: true, departamento: true, avatar: true, role: true } },
  // Incluímos as reações para que o frontend possa calcular contagens por tipo (like, celebrate…)
  reactions: { select: { type: true, userId: true } },
  _count: { select: { comments: true } },
}

export async function feedRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── GET /feed — lista posts aprovados ──────────────────────────────────────
  fastify.get('/', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'List approved feed posts' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
    }).parse(request.query)

    const { skip, take, page, limit } = getPaginationParams(query)

    const [posts, total] = await Promise.all([
      prisma.feedPost.findMany({
        where: { deletedAt: null, status: 'approved' },
        skip,
        take,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        select: postSelect,
      }),
      prisma.feedPost.count({ where: { deletedAt: null, status: 'approved' } }),
    ])

    // Deriva a reação do usuário atual a partir do array de reações já carregado
    const postsWithUserReaction = posts.map(p => ({
      ...p,
      userReaction: p.reactions.find(r => r.userId === request.user.id)?.type ?? null,
    }))

    return reply.send({ data: postsWithUserReaction, meta: buildPaginationMeta(total, page, limit) })
  })

  // ─── GET /feed/pending — posts aguardando aprovação (gestor+) ───────────────
  fastify.get('/pending', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feed'], summary: 'List posts pending approval (gestor+)' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
    }).parse(request.query)

    const { skip, take, page, limit } = getPaginationParams(query)

    // super_admin vê todos; gestor vê apenas os do seu time
    const isGestor = request.user.role === 'gestor'
    let userIdFilter: string[] | undefined

    if (isGestor) {
      const teamMembers = await prisma.user.findMany({
        where: { managerId: request.user.id },
        select: { id: true },
      })
      userIdFilter = teamMembers.map(u => u.id)
    }

    const where: any = { deletedAt: null, status: 'pending' }
    if (userIdFilter) where.userId = { in: userIdFilter }

    const [posts, total] = await Promise.all([
      prisma.feedPost.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: postSelect,
      }),
      prisma.feedPost.count({ where }),
    ])

    const postsWithUserReaction = posts.map(p => ({
      ...p,
      userReaction: p.reactions.find(r => r.userId === request.user.id)?.type ?? null,
    }))

    return reply.send({ data: postsWithUserReaction, meta: buildPaginationMeta(total, page, limit) })
  })

  // ─── GET /feed/mine/pending — meus posts pendentes (colaborador) ─────────────
  fastify.get('/mine/pending', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: "List current user's pending posts" },
  }, async (request, reply) => {
    const posts = await prisma.feedPost.findMany({
      where: { userId: request.user.id, deletedAt: null, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      select: postSelect,
    })
    return reply.send({ data: posts })
  })

  // ─── GET /feed/mine/rejected — meus posts recusados (colaborador) ───────────
  fastify.get('/mine/rejected', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: "List current user's rejected posts" },
  }, async (request, reply) => {
    const posts = await prisma.feedPost.findMany({
      where: { userId: request.user.id, deletedAt: null, status: 'rejected' },
      orderBy: { updatedAt: 'desc' },
      select: postSelect,
    })
    return reply.send({ data: posts })
  })

  // ─── GET /feed/config — configuração de aprovação do gestor ─────────────────
  fastify.get('/config', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feed'], summary: "Get gestor's feed social config" },
  }, async (request, reply) => {
    const config = await prisma.gestorFeedConfig.findUnique({
      where: { gestorId: request.user.id },
    })
    return reply.send({ data: { requireApproval: config?.requireApproval ?? false } })
  })

  // ─── PATCH /feed/config — salvar configuração do gestor ──────────────────────
  fastify.patch('/config', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feed'], summary: "Update gestor's feed social config" },
  }, async (request, reply) => {
    const { requireApproval } = z.object({
      requireApproval: z.boolean(),
    }).parse(request.body)

    const config = await prisma.gestorFeedConfig.upsert({
      where: { gestorId: request.user.id },
      update: { requireApproval },
      create: { gestorId: request.user.id, requireApproval },
    })

    return reply.send({ data: { requireApproval: config.requireApproval } })
  })

  // ─── POST /feed — criar post ─────────────────────────────────────────────────
  fastify.post('/', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'Create a post' },
  }, async (request, reply) => {
    const body = z.object({
      content: z.string().min(1).max(2000),
      imageUrl: z.string().url().nullable().optional(),
      videoUrl: z.string().url().nullable().optional(),
    }).parse(request.body)

    const isColaborador = request.user.role === 'colaborador'

    // Para colaboradores: verifica se o gestor exige aprovação
    let status: 'pending' | 'approved' = 'approved'
    let managerId: string | null = null

    if (isColaborador) {
      const author = await prisma.user.findUnique({
        where: { id: request.user.id },
        select: { nome: true, managerId: true },
      })
      managerId = author?.managerId ?? null

      if (managerId) {
        const gestorConfig = await prisma.gestorFeedConfig.findUnique({
          where: { gestorId: managerId },
        })
        // Só vai para pending se o gestor habilitou aprovação obrigatória
        status = gestorConfig?.requireApproval ? 'pending' : 'approved'
      }
      // Sem gestor → publica direto
    }

    const post = await prisma.feedPost.create({
      data: {
        userId: request.user.id,
        content: body.content,
        imageUrl: body.imageUrl,
        videoUrl: body.videoUrl,
        status,
        approvedAt: status === 'approved' ? new Date() : undefined,
        approvedById: status === 'approved' ? request.user.id : undefined,
      },
      select: postSelect,
    })

    if (status === 'pending' && managerId) {
      // Notificar gestor sobre post pendente
      const authorName = (await prisma.user.findUnique({
        where: { id: request.user.id },
        select: { nome: true },
      }))?.nome ?? 'Colaborador'

      await enqueueNotification({
        userId: managerId,
        type: 'post_pending_approval',
        title: 'Publicação aguardando aprovação',
        message: `${authorName} criou uma publicação aguardando sua aprovação.`,
        data: { postId: post.id, authorId: request.user.id, authorName, content: body.content },
      })
    } else {
      // Post publicado diretamente — concede XP
      await awardXpUseCase({
        userId: request.user.id,
        userRole: request.user.role,
        action: 'criar_post',
        xp: XP_REWARDS.criar_post,
        stars: STAR_REWARDS.criar_post,
      })
    }

    return reply.code(201).send({ data: post })
  })

  // ─── PATCH /feed/:id/status — aprovar ou rejeitar post (gestor+) ────────────
  fastify.patch('/:id/status', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feed'], summary: 'Approve or reject a pending post (gestor+)' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { action, reason } = z.object({
      action: z.enum(['approve', 'reject']),
      reason: z.string().max(500).optional(),
    }).parse(request.body)

    const post = await prisma.feedPost.findFirst({
      where: { id, deletedAt: null, status: 'pending' },
      select: { id: true, userId: true, content: true },
    })
    if (!post) throw new NotFoundError('Post', id)

    if (action === 'approve') {
      await prisma.feedPost.update({
        where: { id },
        data: { status: 'approved', approvedAt: new Date(), approvedById: request.user.id },
      })

      // Conceder XP ao colaborador pela publicação aprovada
      await awardXpUseCase({
        userId: post.userId,
        userRole: 'colaborador',
        action: 'criar_post',
        xp: XP_REWARDS.criar_post,
        stars: STAR_REWARDS.criar_post,
      })

      // Notificar o colaborador
      await enqueueNotification({
        userId: post.userId,
        type: 'post_approved',
        title: 'Publicação aprovada! ✓',
        message: 'Sua publicação foi aprovada e já está visível no Feed Social.',
        data: { postId: post.id },
      })
    } else {
      await prisma.feedPost.update({
        where: { id },
        data: { status: 'rejected', rejectedReason: reason ?? null },
      })

      // Notificar o colaborador
      await enqueueNotification({
        userId: post.userId,
        type: 'post_rejected',
        title: 'Publicação não aprovada',
        message: reason
          ? `Sua publicação foi recusada: ${reason}`
          : 'Sua publicação foi recusada pelo gestor. Você pode editá-la e reenviar.',
        data: { postId: post.id, reason },
      })
    }

    return reply.send({ data: { id, status: action === 'approve' ? 'approved' : 'rejected' } })
  })

  // ─── PATCH /feed/:id — editar post pendente (autor) ─────────────────────────
  fastify.patch('/:id', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'Edit a pending post (author only)' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const body = z.object({
      content: z.string().min(1).max(2000).optional(),
      imageUrl: z.string().url().nullable().optional(),
      videoUrl: z.string().url().nullable().optional(),
    }).parse(request.body)

    const post = await prisma.feedPost.findFirst({
      where: { id, deletedAt: null },
    })
    if (!post) throw new NotFoundError('Post', id)
    if (post.userId !== request.user.id) throw new ForbiddenError('Cannot edit another user\'s post')
    if (post.status === 'approved') throw new ForbiddenError('Cannot edit an already approved post')

    const wasRejected = post.status === 'rejected'

    const updated = await prisma.feedPost.update({
      where: { id },
      data: {
        ...body,
        // Volta para pending após edição de um post rejeitado
        status: wasRejected ? 'pending' : post.status,
        rejectedReason: wasRejected ? null : post.rejectedReason,
      },
      select: postSelect,
    })

    // Se era rejeitado e voltou para pending, notifica o gestor
    if (wasRejected) {
      const author = await prisma.user.findUnique({
        where: { id: request.user.id },
        select: { nome: true, managerId: true },
      })
      if (author?.managerId) {
        await enqueueNotification({
          userId: author.managerId,
          type: 'post_pending_approval',
          title: 'Publicação reenviada para aprovação',
          message: `${author.nome} editou e reenviou uma publicação que aguarda sua aprovação.`,
          data: { postId: updated.id, authorId: request.user.id, authorName: author.nome, content: updated.content },
        })
      }
    }

    return reply.send({ data: updated })
  })

  // ─── GET /feed/:id — buscar post completo ────────────────────────────────────
  fastify.get('/:id', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'Get post by ID' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const post = await prisma.feedPost.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...postSelect,
        comments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, content: true, createdAt: true,
            user: { select: { id: true, nome: true, avatar: true, cargo: true } },
          },
        },
        reactions: {
          select: { type: true, userId: true },
        },
      },
    })
    if (!post) throw new NotFoundError('Post', id)

    // Apenas o dono vê posts pending/rejected; gestores veem todos
    if (post.status !== 'approved') {
      const isOwner = post.user.id === request.user.id
      const canManage = request.user.role !== 'colaborador'
      if (!isOwner && !canManage) throw new ForbiddenError('Post not available')
    }

    return reply.send({ data: post })
  })

  // ─── DELETE /feed/:id — soft delete ─────────────────────────────────────────
  fastify.delete('/:id', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'Delete a post' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const post = await prisma.feedPost.findFirst({ where: { id, deletedAt: null } })
    if (!post) throw new NotFoundError('Post', id)

    if (post.userId !== request.user.id && request.user.role === 'colaborador') {
      throw new ForbiddenError('Cannot delete another user\'s post')
    }

    await prisma.feedPost.update({ where: { id }, data: { deletedAt: new Date() } })
    return reply.code(204).send()
  })

  // ─── POST /feed/:id/react — reagir ao post ───────────────────────────────────
  fastify.post('/:id/react', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'React to a post' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { type } = z.object({
      type: z.enum(['like', 'love', 'celebrate', 'support', 'insightful']),
    }).parse(request.body)

    const post = await prisma.feedPost.findFirst({
      where: { id, deletedAt: null, status: 'approved' },
      select: { id: true, userId: true },
    })
    if (!post) throw new NotFoundError('Post', id)

    // Toggle: mesma reação remove; reação diferente substitui
    const existing = await prisma.feedReaction.findFirst({
      where: { postId: id, userId: request.user.id },
    })

    if (existing) {
      if (existing.type === type) {
        await prisma.feedReaction.delete({ where: { id: existing.id } })
        return reply.send({ data: { reacted: false, type } })
      }
      await prisma.feedReaction.update({ where: { id: existing.id }, data: { type } })
    } else {
      await prisma.feedReaction.create({
        data: { postId: id, userId: request.user.id, type },
      })

      // XP para quem reagiu
      await awardXpUseCase({
        userId: request.user.id,
        userRole: request.user.role,
        action: 'reagir_post',
        xp: XP_REWARDS.reagir_post,
      })

      // Notificar o dono do post (se não for o próprio usuário)
      if (post.userId !== request.user.id) {
        const reactor = await prisma.user.findUnique({
          where: { id: request.user.id },
          select: { nome: true },
        })
        await enqueueNotification({
          userId: post.userId,
          type: 'post_liked',
          title: 'Sua publicação recebeu uma reação',
          message: `${reactor?.nome ?? 'Alguém'} reagiu à sua publicação.`,
          data: { postId: id, reactorId: request.user.id, reactionType: type },
        })
      }
    }

    return reply.code(201).send({ data: { reacted: true, type } })
  })

  // ─── POST /feed/:id/view — registrar visualização ───────────────────────────
  fastify.post('/:id/view', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'Register a post view' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const post = await prisma.feedPost.findFirst({
      where: { id, deletedAt: null, status: 'approved' },
      select: { id: true },
    })
    if (!post) throw new NotFoundError('Post', id)

    // upsert: garante idempotência (um usuário conta uma vez)
    const isNewView = await prisma.feedPostView.findUnique({
      where: { postId_userId: { postId: id, userId: request.user.id } },
    })

    if (!isNewView) {
      await prisma.$transaction([
        prisma.feedPostView.create({ data: { postId: id, userId: request.user.id } }),
        prisma.feedPost.update({ where: { id }, data: { viewsCount: { increment: 1 } } }),
      ])
    }

    return reply.code(204).send()
  })

  // ─── POST /feed/:id/comments — comentar post ─────────────────────────────────
  fastify.post('/:id/comments', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'Add comment to post' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { content } = z.object({ content: z.string().min(1).max(1000) }).parse(request.body)

    const post = await prisma.feedPost.findFirst({
      where: { id, deletedAt: null, status: 'approved' },
      select: { id: true, userId: true },
    })
    if (!post) throw new NotFoundError('Post', id)

    const comment = await prisma.feedComment.create({
      data: { postId: id, userId: request.user.id, content },
      select: {
        id: true, content: true, createdAt: true,
        user: { select: { id: true, nome: true, avatar: true, cargo: true } },
      },
    })

    // XP para quem comentou
    await awardXpUseCase({
      userId: request.user.id,
      userRole: request.user.role,
      action: 'comentar_post',
      xp: XP_REWARDS.comentar_post,
    })

    // Notificar dono do post (se não for o próprio)
    if (post.userId !== request.user.id) {
      const commenter = await prisma.user.findUnique({
        where: { id: request.user.id },
        select: { nome: true },
      })
      await enqueueNotification({
        userId: post.userId,
        type: 'post_commented',
        title: 'Novo comentário na sua publicação',
        message: `${commenter?.nome ?? 'Alguém'} comentou na sua publicação.`,
        data: { postId: id, commentId: comment.id, commenterId: request.user.id },
      })
    }

    return reply.code(201).send({ data: comment })
  })

  // ─── DELETE /feed/:postId/comments/:commentId ────────────────────────────────
  fastify.delete('/:postId/comments/:commentId', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'Delete comment' },
  }, async (request, reply) => {
    const { postId, commentId } = z.object({
      postId: z.string(),
      commentId: z.string(),
    }).parse(request.params)

    const comment = await prisma.feedComment.findFirst({
      where: { id: commentId, postId, deletedAt: null },
    })
    if (!comment) throw new NotFoundError('Comment', commentId)

    if (comment.userId !== request.user.id && request.user.role === 'colaborador') {
      throw new ForbiddenError('Cannot delete another user\'s comment')
    }

    await prisma.feedComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } })
    return reply.code(204).send()
  })

  // ─── PATCH /feed/:id/pin — fixar post (gestor+) ──────────────────────────────
  fastify.patch('/:id/pin', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Feed'], summary: 'Pin/unpin post (gestor+)' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const post = await prisma.feedPost.findFirst({ where: { id, deletedAt: null } })
    if (!post) throw new NotFoundError('Post', id)

    const updated = await prisma.feedPost.update({
      where: { id },
      data: { isPinned: !post.isPinned },
      select: { id: true, isPinned: true },
    })

    return reply.send({ data: updated })
  })
}

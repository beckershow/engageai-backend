import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { awardXpUseCase, XP_REWARDS, STAR_REWARDS } from '../../../application/gamification/award-xp.usecase.js'
import { NotFoundError, ForbiddenError } from '../../../shared/errors/app-error.js'
import { getPaginationParams, buildPaginationMeta } from '../../../shared/utils/pagination.js'

const postSelect = {
  id: true,
  content: true,
  imageUrl: true,
  isPinned: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, nome: true, cargo: true, departamento: true, avatar: true, role: true } },
  _count: { select: { reactions: true, comments: true } },
}

export async function feedRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /feed - list posts
  fastify.get('/', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'List feed posts' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
    }).parse(request.query)

    const { skip, take, page, limit } = getPaginationParams(query)

    const [posts, total] = await Promise.all([
      prisma.feedPost.findMany({
        where: { deletedAt: null },
        skip,
        take,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        select: postSelect,
      }),
      prisma.feedPost.count({ where: { deletedAt: null } }),
    ])

    // Add user's reaction for each post
    const postIds = posts.map(p => p.id)
    const userReactions = await prisma.feedReaction.findMany({
      where: { postId: { in: postIds }, userId: request.user.id },
    })
    const reactionMap = new Map(userReactions.map(r => [r.postId, r.type]))

    const postsWithReactions = posts.map(p => ({
      ...p,
      userReaction: reactionMap.get(p.id) ?? null,
    }))

    return reply.send({ data: postsWithReactions, meta: buildPaginationMeta(total, page, limit) })
  })

  // POST /feed - create post
  fastify.post('/', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'Create a post' },
  }, async (request, reply) => {
    const body = z.object({
      content: z.string().min(1).max(2000),
      imageUrl: z.string().url().optional(),
    }).parse(request.body)

    const post = await prisma.feedPost.create({
      data: { userId: request.user.id, ...body },
      select: postSelect,
    })

    await awardXpUseCase({
      userId: request.user.id,
      userRole: request.user.role,
      action: 'criar_post',
      xp: XP_REWARDS.criar_post,
      stars: STAR_REWARDS.criar_post,
    })

    return reply.code(201).send({ data: post })
  })

  // GET /feed/:id - get single post
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
    return reply.send({ data: post })
  })

  // DELETE /feed/:id - soft delete
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

  // POST /feed/:id/react - react to post
  fastify.post('/:id/react', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'React to a post' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { type } = z.object({
      type: z.enum(['like', 'love', 'celebrate', 'support', 'insightful']),
    }).parse(request.body)

    const post = await prisma.feedPost.findFirst({ where: { id, deletedAt: null } })
    if (!post) throw new NotFoundError('Post', id)

    // Toggle: if same reaction exists, remove it
    const existing = await prisma.feedReaction.findUnique({
      where: { postId_userId_type: { postId: id, userId: request.user.id, type } },
    })

    if (existing) {
      await prisma.feedReaction.delete({ where: { id: existing.id } })
      return reply.send({ data: { reacted: false, type } })
    }

    await prisma.feedReaction.create({
      data: { postId: id, userId: request.user.id, type },
    })

    await awardXpUseCase({
      userId: request.user.id,
      userRole: request.user.role,
      action: 'reagir_post',
      xp: XP_REWARDS.reagir_post,
    })

    return reply.code(201).send({ data: { reacted: true, type } })
  })

  // POST /feed/:id/comments - add comment
  fastify.post('/:id/comments', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'Add comment to post' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { content } = z.object({ content: z.string().min(1).max(1000) }).parse(request.body)

    const post = await prisma.feedPost.findFirst({ where: { id, deletedAt: null } })
    if (!post) throw new NotFoundError('Post', id)

    const comment = await prisma.feedComment.create({
      data: { postId: id, userId: request.user.id, content },
      select: {
        id: true, content: true, createdAt: true,
        user: { select: { id: true, nome: true, avatar: true, cargo: true } },
      },
    })

    await awardXpUseCase({
      userId: request.user.id,
      userRole: request.user.role,
      action: 'comentar_post',
      xp: XP_REWARDS.comentar_post,
    })

    return reply.code(201).send({ data: comment })
  })

  // DELETE /feed/:postId/comments/:commentId
  fastify.delete('/:postId/comments/:commentId', {
    preHandler: [authenticate],
    schema: { tags: ['Feed'], summary: 'Delete comment' },
  }, async (request, reply) => {
    const { postId, commentId } = z.object({ postId: z.string(), commentId: z.string() }).parse(request.params)

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

  // PATCH /feed/:id/pin - pin post (gestor+)
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

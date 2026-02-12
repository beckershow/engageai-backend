import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { NotFoundError, ForbiddenError } from '../../../shared/errors/app-error.js'
import { getPaginationParams, buildPaginationMeta } from '../../../shared/utils/pagination.js'

const CriterioSchema = z.object({
  acao: z.enum(['registro_humor', 'publicacao_feed', 'curtida', 'comentario', 'envio_feedback',
    'resposta_pesquisa', 'conclusao_treinamento', 'participacao_trilha', 'participacao_evento', 'interacao_recorrente']),
  quantidadeMinima: z.number().int().min(1),
  descricao: z.string().optional(),
})

export async function goalsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /goals
  fastify.get('/', {
    preHandler: [authenticate],
    schema: { tags: ['Goals'], summary: 'List goals' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
      status: z.enum(['rascunho', 'ativa', 'inativa', 'concluida']).optional(),
    }).parse(request.query)

    const { skip, take, page, limit } = getPaginationParams(query)

    const isAdmin = request.user.role === 'super_admin'
    const isGestor = request.user.role === 'gestor'

    let where: any = {}
    if (!isAdmin) {
      // Gestores see goals available to them + active goals
      if (isGestor) {
        where.OR = [
          { status: 'ativa' },
          { creatorId: request.user.id },
        ]
      } else {
        // Colaboradores only see active goals that have been activated for them
        where.status = 'ativa'
      }
    }
    if (query.status) where.status = query.status

    const [goals, total] = await Promise.all([
      prisma.goal.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          criterios: true,
          creator: { select: { id: true, nome: true } },
          _count: { select: { progress: true, activations: true } },
        },
      }),
      prisma.goal.count({ where }),
    ])

    // Add user progress for colaboradores
    if (request.user.role === 'colaborador') {
      const goalIds = goals.map(g => g.id)
      const userProgress = await prisma.goalProgress.findMany({
        where: { goalId: { in: goalIds }, userId: request.user.id },
      })
      const progressMap = new Map(userProgress.map(p => [p.goalId, p]))

      return reply.send({
        data: goals.map(g => ({ ...g, userProgress: progressMap.get(g.id) ?? null })),
        meta: buildPaginationMeta(total, page, limit),
      })
    }

    return reply.send({ data: goals, meta: buildPaginationMeta(total, page, limit) })
  })

  // POST /goals (super_admin)
  fastify.post('/', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Goals'], summary: 'Create goal (super_admin)' },
  }, async (request, reply) => {
    const body = z.object({
      nome: z.string().min(1),
      descricao: z.string().optional(),
      tipo: z.enum(['engajamento', 'desenvolvimento', 'lideranca']),
      publicoAlvo: z.enum(['colaboradores', 'gestores']),
      escopo: z.enum(['individual', 'time']),
      periodo: z.enum(['semanal', 'mensal', 'trimestral']),
      disponivelParaGestores: z.boolean().default(false),
      criterios: z.array(CriterioSchema).min(1),
    }).parse(request.body)

    const { criterios, ...goalData } = body
    const goal = await prisma.goal.create({
      data: {
        ...goalData,
        creatorId: request.user.id,
        criterios: { create: criterios },
      },
      include: { criterios: true },
    })

    return reply.code(201).send({ data: goal })
  })

  // PUT /goals/:id/activate - gestor activates goal for team
  fastify.put('/:id/activate', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Goals'], summary: 'Activate goal for team (gestor)' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const goal = await prisma.goal.findUnique({
      where: { id },
      include: { criterios: true },
    })
    if (!goal) throw new NotFoundError('Goal', id)
    if (!goal.disponivelParaGestores && request.user.role !== 'super_admin') {
      throw new ForbiddenError('Goal not available for managers to activate')
    }

    // Register activation
    await prisma.goalActivation.upsert({
      where: { goalId_gestorId: { goalId: id, gestorId: request.user.id } },
      create: { goalId: id, gestorId: request.user.id },
      update: {},
    })

    // Create progress records for team members
    const team = await prisma.user.findMany({
      where: { managerId: request.user.id, role: 'colaborador', isActive: true },
      select: { id: true },
    })

    for (const member of team) {
      await prisma.goalProgress.upsert({
        where: { goalId_userId: { goalId: id, userId: member.id } },
        create: {
          goalId: id,
          userId: member.id,
          criterioProgress: {
            create: goal.criterios.map(c => ({ criterioId: c.id })),
          },
        },
        update: {},
      })
    }

    return reply.send({ data: { activated: true, teamSize: team.length } })
  })

  // GET /goals/:id/progress - get progress for a goal
  fastify.get('/:id/progress', {
    preHandler: [authenticate],
    schema: { tags: ['Goals'], summary: 'Get goal progress' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const isColaborador = request.user.role === 'colaborador'
    const where: any = { goalId: id }
    if (isColaborador) where.userId = request.user.id

    const progress = await prisma.goalProgress.findMany({
      where,
      include: {
        user: { select: { id: true, nome: true, avatar: true, departamento: true } },
        criterioProgress: {
          include: { criterio: true },
        },
      },
    })

    return reply.send({ data: progress })
  })

  // PATCH /goals/:id/status (super_admin)
  fastify.patch('/:id/status', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Goals'], summary: 'Update goal status' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { status } = z.object({
      status: z.enum(['rascunho', 'ativa', 'inativa', 'concluida']),
    }).parse(request.body)

    const goal = await prisma.goal.update({ where: { id }, data: { status } })
    return reply.send({ data: goal })
  })
}

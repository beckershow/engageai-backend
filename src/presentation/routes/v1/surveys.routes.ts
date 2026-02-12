import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { awardXpUseCase, XP_REWARDS, STAR_REWARDS } from '../../../application/gamification/award-xp.usecase.js'
import { NotFoundError, ForbiddenError, ConflictError } from '../../../shared/errors/app-error.js'
import { getPaginationParams, buildPaginationMeta } from '../../../shared/utils/pagination.js'

const QuestionSchema = z.object({
  type: z.enum(['rating', 'text', 'nps', 'checkbox', 'radio', 'scale']),
  text: z.string().min(1),
  options: z.array(z.string()).optional().default([]),
  required: z.boolean().default(true),
  order: z.number().int().default(0),
})

const CreateSurveySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['rapida', 'nps', 'clima', 'avaliacao_360', 'custom']),
  deadline: z.string().datetime().optional(),
  rewardXP: z.number().int().min(0).default(40),
  targetAudience: z.enum(['todo_time', 'colaboradores_especificos', 'por_departamento']).default('todo_time'),
  targetIds: z.array(z.string()).default([]),
  isAnonymous: z.boolean().default(false),
  questions: z.array(QuestionSchema).min(1),
})

export async function surveysRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /surveys
  fastify.get('/', {
    preHandler: [authenticate],
    schema: { tags: ['Surveys'], summary: 'List surveys' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
      status: z.enum(['rascunho', 'ativa', 'encerrada', 'arquivada']).optional(),
    }).parse(request.query)

    const { skip, take, page, limit } = getPaginationParams(query)
    const isAdmin = request.user.role !== 'colaborador'

    const where: any = {}
    if (!isAdmin) {
      // Colaboradores only see active surveys they're targeted for
      where.status = 'ativa'
    } else if (query.status) {
      where.status = query.status
    }

    const [surveys, total] = await Promise.all([
      prisma.survey.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: { select: { id: true, nome: true } },
          _count: { select: { questions: true, responses: true } },
        },
      }),
      prisma.survey.count({ where }),
    ])

    // For each survey, check if user already responded
    const surveyIds = surveys.map(s => s.id)
    const userResponses = await prisma.surveyResponse.findMany({
      where: { surveyId: { in: surveyIds }, userId: request.user.id },
      select: { surveyId: true },
    })
    const respondedSet = new Set(userResponses.map(r => r.surveyId))

    const surveysWithStatus = surveys.map(s => ({
      ...s,
      hasResponded: respondedSet.has(s.id),
    }))

    return reply.send({ data: surveysWithStatus, meta: buildPaginationMeta(total, page, limit) })
  })

  // GET /surveys/:id
  fastify.get('/:id', {
    preHandler: [authenticate],
    schema: { tags: ['Surveys'], summary: 'Get survey by ID' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const survey = await prisma.survey.findUnique({
      where: { id },
      include: {
        questions: { orderBy: { order: 'asc' } },
        creator: { select: { id: true, nome: true } },
        _count: { select: { responses: true } },
      },
    })
    if (!survey) throw new NotFoundError('Survey', id)

    const hasResponded = !!(await prisma.surveyResponse.findUnique({
      where: { surveyId_userId: { surveyId: id, userId: request.user.id } },
    }))

    return reply.send({ data: { ...survey, hasResponded } })
  })

  // POST /surveys (gestor+)
  fastify.post('/', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Surveys'], summary: 'Create survey (gestor+)' },
  }, async (request, reply) => {
    const body = CreateSurveySchema.parse(request.body)
    const { questions, ...surveyData } = body

    const survey = await prisma.survey.create({
      data: {
        ...surveyData,
        deadline: surveyData.deadline ? new Date(surveyData.deadline) : undefined,
        creatorId: request.user.id,
        questions: {
          create: questions.map((q, idx) => ({ ...q, order: q.order || idx })),
        },
      },
      include: {
        questions: true,
        _count: { select: { responses: true } },
      },
    })

    return reply.code(201).send({ data: survey })
  })

  // PUT /surveys/:id (gestor+)
  fastify.put('/:id', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Surveys'], summary: 'Update survey (gestor+)' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const body = z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(['rascunho', 'ativa', 'encerrada', 'arquivada']).optional(),
      deadline: z.string().datetime().optional(),
    }).parse(request.body)

    const survey = await prisma.survey.update({
      where: { id },
      data: {
        ...body,
        deadline: body.deadline ? new Date(body.deadline) : undefined,
      },
    })

    return reply.send({ data: survey })
  })

  // DELETE /surveys/:id (admin)
  fastify.delete('/:id', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Surveys'], summary: 'Delete survey' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    await prisma.survey.delete({ where: { id } })
    return reply.code(204).send()
  })

  // POST /surveys/:id/respond - submit survey response
  fastify.post('/:id/respond', {
    preHandler: [authenticate],
    schema: { tags: ['Surveys'], summary: 'Submit survey response' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { answers } = z.object({
      answers: z.array(z.object({
        questionId: z.string(),
        value: z.union([z.string(), z.number(), z.array(z.string())]),
      })).min(1),
    }).parse(request.body)

    const survey = await prisma.survey.findUnique({
      where: { id },
      include: { questions: true },
    })
    if (!survey) throw new NotFoundError('Survey', id)
    if (survey.status !== 'ativa') throw new ForbiddenError('Survey is not active')

    const existing = await prisma.surveyResponse.findUnique({
      where: { surveyId_userId: { surveyId: id, userId: request.user.id } },
    })
    if (existing) throw new ConflictError('Already responded to this survey')

    const response = await prisma.surveyResponse.create({
      data: {
        surveyId: id,
        userId: request.user.id,
        answers: {
          create: answers.map(a => ({
            questionId: a.questionId,
            value: JSON.stringify(a.value),
          })),
        },
      },
    })

    await awardXpUseCase({
      userId: request.user.id,
      userRole: request.user.role,
      action: 'responder_pesquisa',
      xp: survey.rewardXP || XP_REWARDS.responder_pesquisa,
      stars: STAR_REWARDS.responder_pesquisa,
    })

    return reply.code(201).send({ data: { responseId: response.id } })
  })

  // GET /surveys/:id/results (gestor+)
  fastify.get('/:id/results', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Surveys'], summary: 'Get survey results (gestor+)' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const survey = await prisma.survey.findUnique({
      where: { id },
      include: {
        questions: { include: { responses: true } },
        responses: {
          include: {
            answers: true,
            user: { select: { id: true, nome: true, departamento: true } },
          },
        },
        _count: { select: { responses: true } },
      },
    })
    if (!survey) throw new NotFoundError('Survey', id)

    // For anonymous surveys, hide user info from responses
    const result = survey.isAnonymous
      ? {
          ...survey,
          responses: survey.responses.map(r => ({ ...r, user: undefined })),
        }
      : survey

    return reply.send({ data: result })
  })
}

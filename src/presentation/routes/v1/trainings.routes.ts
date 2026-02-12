import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { NotFoundError, ForbiddenError } from '../../../shared/errors/app-error.js'
import { getPaginationParams, buildPaginationMeta } from '../../../shared/utils/pagination.js'
import { awardXpUseCase } from '../../../application/gamification/award-xp.usecase.js'

const contentOriginMap: Record<string, string> = {
  texto: 'texto',
  documento: 'documento',
  audio: 'audio',
  video: 'video',
}

const contentFormatMap: Record<string, string> = {
  texto: 'texto',
  audio: 'audio',
  video: 'video',
}

const questionTypeMap: Record<string, string> = {
  'multipla-escolha': 'multipla_escolha',
  descritiva: 'descritiva',
}

const answerTypeMap: Record<string, string> = {
  'multipla-escolha': 'multipla_escolha',
  descritiva: 'descritiva',
  checkbox: 'checkbox',
  audio: 'audio',
  video: 'video',
}

const audienceTypeMap: Record<string, string> = {
  'todo-time': 'todo_time',
  'colaboradores-especificos': 'colaboradores_especificos',
  'por-departamento': 'por_departamento',
}

function normalizeDate(input?: string | null): Date | null {
  if (!input || !input.trim()) return null
  const value = new Date(input)
  return Number.isNaN(value.getTime()) ? null : value
}

function mapEnumArray(values: string[], mapper: Record<string, string>): string[] {
  return values.map((v) => mapper[v]).filter(Boolean)
}

export async function trainingsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /trainings
  fastify.get('/', {
    preHandler: [authenticate],
    schema: { tags: ['Trainings'], summary: 'List trainings' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
      campaignId: z.string().optional(),
      audienceType: z.enum(['todo_time', 'colaboradores_especificos', 'por_departamento']).optional(),
      creatorId: z.string().optional(),
      createdFrom: z.string().datetime().optional(),
      createdTo: z.string().datetime().optional(),
      includeDeleted: z.coerce.boolean().optional(),
    }).parse(request.query)

    const { skip, take, page, limit } = getPaginationParams(query)
    const where: any = {}
    if (query.campaignId) where.campaignId = query.campaignId
    if (query.audienceType) where.audienceType = query.audienceType
    if (query.creatorId) where.creatorId = query.creatorId
    if (!query.includeDeleted) where.deletedAt = null
    if (query.createdFrom || query.createdTo) {
      where.createdAt = {}
      if (query.createdFrom) where.createdAt.gte = new Date(query.createdFrom)
      if (query.createdTo) where.createdAt.lte = new Date(query.createdTo)
    }

    const [trainings, total] = await Promise.all([
      prisma.training.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          description: true,
          coverType: true,
          coverUrl: true,
          primaryColor: true,
          campaignId: true,
          contentOrigin: true,
          noAssessment: true,
          convertContent: true,
          summaryPercent: true,
          questionsRequired: true,
          requireSequential: true,
          audienceType: true,
          startDate: true,
          endDate: true,
          rewardsActive: true,
          rewardXP: true,
          rewardStars: true,
          createdAt: true,
          creator: { select: { id: true, nome: true } },
          _count: { select: { questions: true } },
        },
      }),
      prisma.training.count({ where }),
    ])

    const trainingIds = trainings.map((t) => t.id)
    const userProgress = await prisma.trainingProgress.findMany({
      where: { trainingId: { in: trainingIds }, userId: request.user.id },
      select: { trainingId: true, progress: true, score: true, completedAt: true, startedAt: true },
    })
    const progressMap = new Map(userProgress.map((p) => [p.trainingId, p]))

    return reply.send({
      data: trainings.map((t) => ({
        ...t,
        userProgress: progressMap.get(t.id) ?? null,
      })),
      meta: buildPaginationMeta(total, page, limit),
    })
  })

  // GET /trainings/progress/me
  fastify.get('/progress/me', {
    preHandler: [authenticate],
    schema: { tags: ['Trainings'], summary: 'Get my training progress' },
  }, async (request, reply) => {
    const progress = await prisma.trainingProgress.findMany({
      where: { userId: request.user.id },
      select: { trainingId: true, progress: true, score: true, completedAt: true, startedAt: true },
    })

    return reply.send({ data: progress })
  })

  // GET /trainings/:id
  fastify.get('/:id', {
    preHandler: [authenticate],
    schema: { tags: ['Trainings'], summary: 'Get training by ID' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const training = await prisma.training.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, nome: true } },
        questions: { orderBy: { order: 'asc' } },
        progress: {
          where: { userId: request.user.id },
          select: { progress: true, score: true, completedAt: true, startedAt: true },
        },
      },
    })
    if (!training || training.deletedAt) throw new NotFoundError('Training', id)

    const questionProgress = await prisma.trainingQuestionProgress.findMany({
      where: { trainingId: id, userId: request.user.id },
      select: { questionId: true, answeredAt: true },
    })

    const userProgress = training.progress[0] ?? null
    return reply.send({
      data: {
        ...training,
        userProgress,
        userQuestionProgress: questionProgress,
      },
    })
  })

  // POST /trainings (gestor+)
  fastify.post('/', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Trainings'], summary: 'Create training (gestor+)' },
  }, async (request, reply) => {
    const body = z.object({
      titulo: z.string().min(1),
      descricao: z.string().optional(),
      capa: z.object({
        tipo: z.enum(['upload', 'url']).default('url'),
        valor: z.string().optional(),
      }).default({ tipo: 'url', valor: '' }),
      corPrincipal: z.string().optional(),
      vinculadoCampanha: z.boolean().default(false),
      campanhaId: z.string().optional(),
      conteudoOrigem: z.enum(['texto', 'documento', 'audio', 'video']).optional(),
      conteudoTexto: z.string().optional(),
      conteudoArquivo: z.string().optional(),
      conteudoArquivos: z.array(z.string()).optional(),
      semAvaliacao: z.boolean().default(false),
      converterConteudo: z.boolean().default(false),
      tipoConversao: z.enum(['audio', 'video']).optional(),
      disponibilizarOriginal: z.boolean().default(false),
      percentualResumo: z.number().int().min(0).max(100).default(0),
      resumoGerado: z.string().optional(),
      resumoConfirmado: z.boolean().default(false),
      iaConfig: z.any().optional(),
      iaConversoes: z.array(z.enum(['texto', 'audio', 'video'])).default([]),
      colaboradorVe: z.array(z.enum(['texto', 'audio', 'video'])).default([]),
      questoes: z.array(z.object({
        pergunta: z.string().min(1),
        tipo: z.enum(['multipla-escolha', 'descritiva']),
        tiposResposta: z.array(z.enum(['multipla-escolha', 'descritiva', 'checkbox', 'audio', 'video'])).default([]),
        alternativas: z.array(z.string()).optional(),
        alternativaCorreta: z.number().int().optional(),
        order: z.number().int().default(0),
      })).default([]),
      ordemObrigatoria: z.boolean().default(false),
      publicoTipo: z.enum(['todo-time', 'colaboradores-especificos', 'por-departamento']).default('todo-time'),
      colaboradoresSelecionados: z.array(z.string()).default([]),
      questoesObrigatorias: z.boolean().default(true),
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
      ganhosAtivos: z.boolean().default(true),
      xp: z.number().int().min(0).default(0),
      estrelas: z.number().int().min(0).default(0),
    }).parse(request.body)

    const contentFiles = body.conteudoArquivos?.length
      ? body.conteudoArquivos
      : (body.conteudoArquivo ? [body.conteudoArquivo] : [])

    const startDate = normalizeDate(body.dataInicio)
    const endDate = normalizeDate(body.dataFim)
    if (startDate && endDate && endDate < startDate) {
      return reply.code(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'dataFim must be >= dataInicio',
          statusCode: 422,
        },
      })
    }

    const training = await prisma.training.create({
      data: {
        title: body.titulo,
        description: body.descricao,
        coverType: body.capa.tipo,
        coverUrl: body.capa.valor,
        primaryColor: body.corPrincipal,
        campaignId: body.vinculadoCampanha ? body.campanhaId : null,
        contentOrigin: body.conteudoOrigem ? contentOriginMap[body.conteudoOrigem] : null,
        contentText: body.conteudoTexto,
        contentFiles,
        noAssessment: body.semAvaliacao,
        convertContent: body.converterConteudo,
        conversionType: body.tipoConversao ? contentFormatMap[body.tipoConversao] : null,
        allowOriginal: body.disponibilizarOriginal,
        summaryPercent: body.percentualResumo,
        summaryText: body.resumoGerado,
        summaryConfirmed: body.resumoConfirmado,
        aiConfig: body.iaConfig ?? null,
        aiConversions: mapEnumArray(body.iaConversoes, contentFormatMap),
        visibleFormats: mapEnumArray(body.colaboradorVe, contentFormatMap),
        questionsRequired: body.questoesObrigatorias,
        requireSequential: body.ordemObrigatoria,
        audienceType: audienceTypeMap[body.publicoTipo],
        audienceIds: body.colaboradoresSelecionados,
        startDate,
        endDate,
        rewardsActive: body.ganhosAtivos,
        rewardXP: body.xp,
        rewardStars: body.estrelas,
        creatorId: request.user.id,
        questions: {
          create: body.questoes.map((q, idx) => ({
            question: q.pergunta,
            type: questionTypeMap[q.tipo],
            answerTypes: mapEnumArray(q.tiposResposta, answerTypeMap),
            options: q.alternativas ?? [],
            correctOption: q.alternativaCorreta,
            order: q.order ?? idx,
          })),
        },
      },
      include: { questions: { orderBy: { order: 'asc' } } },
    })

    return reply.code(201).send({ data: training })
  })

  // POST /trainings/:id/start
  fastify.post('/:id/start', {
    preHandler: [authenticate],
    schema: { tags: ['Trainings'], summary: 'Start training' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const training = await prisma.training.findUnique({
      where: { id },
      include: { questions: { select: { id: true, correctOption: true, options: true } } },
    })
    if (!training || training.deletedAt) throw new NotFoundError('Training', id)

    const existing = await prisma.trainingProgress.findUnique({
      where: { trainingId_userId: { trainingId: id, userId: request.user.id } },
    })
    if (existing) return reply.send({ data: existing })

    const progress = await prisma.trainingProgress.create({
      data: {
        trainingId: id,
        userId: request.user.id,
        progress: 0,
      },
    })

    return reply.code(201).send({ data: progress })
  })

  // POST /trainings/:id/complete
  fastify.post('/:id/complete', {
    preHandler: [authenticate],
    schema: { tags: ['Trainings'], summary: 'Complete training' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training || training.deletedAt) throw new NotFoundError('Training', id)

    const existing = await prisma.trainingProgress.findUnique({
      where: { trainingId_userId: { trainingId: id, userId: request.user.id } },
    })
    if (!existing) throw new ForbiddenError('Training not started')
    if (existing.completedAt) {
      return reply.send({ data: existing })
    }

    if (training.questionsRequired && training.questions.length > 0) {
      const answeredCount = await prisma.trainingQuestionProgress.count({
        where: { trainingId: id, userId: request.user.id },
      })
      if (answeredCount < training.questions.length) {
        throw new ForbiddenError('All questions must be answered before completion')
      }
    }

    // Calculate score
    let score = 0
    if (training.questions.length > 0) {
      const answers = await prisma.trainingQuestionProgress.findMany({
        where: { trainingId: id, userId: request.user.id },
        select: { questionId: true, answer: true },
      })
      const questionMap = new Map(training.questions.map((q) => [q.id, q]))
      let correct = 0
      let total = 0

      answers.forEach((a) => {
        const q = questionMap.get(a.questionId)
        if (!q || q.correctOption === null || q.correctOption === undefined) return
        total += 1
        const parsed = JSON.parse(a.answer)
        const correctValue = q.options?.[q.correctOption]
        if (typeof parsed === 'string' && correctValue && parsed === correctValue) {
          correct += 1
        }
      })

      if (total > 0) {
        score = Math.round((correct / total) * 100)
      }
    }

    const progress = await prisma.trainingProgress.update({
      where: { trainingId_userId: { trainingId: id, userId: request.user.id } },
      data: {
        progress: 100,
        score,
        completedAt: new Date(),
      },
    })

    if (training.rewardsActive) {
      await awardXpUseCase({
        userId: request.user.id,
        userRole: request.user.role,
        action: 'completar_treinamento',
        xp: training.rewardXP,
        stars: training.rewardStars,
        context: { trainingId: id },
      })
    }

    return reply.send({ data: progress })
  })

  // POST /trainings/:id/questions/:questionId/answer
  fastify.post('/:id/questions/:questionId/answer', {
    preHandler: [authenticate],
    schema: { tags: ['Trainings'], summary: 'Answer training question' },
  }, async (request, reply) => {
    const { id, questionId } = z.object({
      id: z.string(),
      questionId: z.string(),
    }).parse(request.params)
    const body = z.object({
      value: z.union([z.string(), z.number(), z.array(z.string())]),
    }).parse(request.body)

    const training = await prisma.training.findUnique({
      where: { id },
      include: { questions: { select: { id: true, options: true, answerTypes: true } } },
    })
    if (!training || training.deletedAt) throw new NotFoundError('Training', id)

    const question = training.questions.find((q) => q.id === questionId)
    if (!question) throw new NotFoundError('TrainingQuestion', questionId)

    // Validate answer
    const hasOptions = (question.options?.length ?? 0) > 0
    const expectsCheckbox = question.answerTypes.includes('checkbox')
    const expectsText = question.answerTypes.includes('descritiva')

    let normalized: string | string[] | null = null
    if (expectsCheckbox) {
      if (!Array.isArray(body.value)) {
        throw new ForbiddenError('Answer must be an array for checkbox type')
      }
      normalized = body.value
    } else if (typeof body.value === 'number') {
      if (!hasOptions) throw new ForbiddenError('Numeric answer requires options')
      const opt = question.options?.[body.value]
      if (!opt) throw new ForbiddenError('Invalid option index')
      normalized = opt
    } else if (typeof body.value === 'string') {
      normalized = body.value
    } else {
      throw new ForbiddenError('Invalid answer type')
    }

    if (hasOptions) {
      if (Array.isArray(normalized)) {
        const invalid = normalized.find((v) => !question.options?.includes(v))
        if (invalid) throw new ForbiddenError('Invalid option value')
      } else if (!question.options?.includes(normalized)) {
        if (!expectsText) {
          throw new ForbiddenError('Invalid option value')
        }
      }
    } else if (expectsText) {
      if (typeof normalized !== 'string' || normalized.trim().length === 0) {
        throw new ForbiddenError('Answer cannot be empty')
      }
    }

    // Ensure training progress exists
    const progress = await prisma.trainingProgress.upsert({
      where: { trainingId_userId: { trainingId: id, userId: request.user.id } },
      create: {
        trainingId: id,
        userId: request.user.id,
        progress: 0,
      },
      update: {},
    })

    await prisma.trainingQuestionProgress.upsert({
      where: { questionId_userId: { questionId, userId: request.user.id } },
      create: {
        trainingId: id,
        questionId,
        userId: request.user.id,
        answer: JSON.stringify(normalized),
      },
      update: {
        answer: JSON.stringify(normalized),
        answeredAt: new Date(),
      },
    })

    const answeredCount = await prisma.trainingQuestionProgress.count({
      where: { trainingId: id, userId: request.user.id },
    })
    const totalQuestions = training.questions.length || 1
    const progressPct = Math.round((answeredCount / totalQuestions) * 100)

    const updated = await prisma.trainingProgress.update({
      where: { id: progress.id },
      data: { progress: progressPct },
    })

    return reply.send({
      data: {
        progress: updated,
        answered: answeredCount,
        total: totalQuestions,
      },
    })
  })

  // PUT /trainings/:id (gestor+)
  fastify.put('/:id', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Trainings'], summary: 'Update training (gestor+)' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const body = z.object({
      titulo: z.string().min(1).optional(),
      descricao: z.string().optional(),
      capa: z.object({
        tipo: z.enum(['upload', 'url']).optional(),
        valor: z.string().optional(),
      }).optional(),
      corPrincipal: z.string().optional(),
      vinculadoCampanha: z.boolean().optional(),
      campanhaId: z.string().optional(),
      conteudoOrigem: z.enum(['texto', 'documento', 'audio', 'video']).optional(),
      conteudoTexto: z.string().optional(),
      conteudoArquivo: z.string().optional(),
      conteudoArquivos: z.array(z.string()).optional(),
      semAvaliacao: z.boolean().optional(),
      converterConteudo: z.boolean().optional(),
      tipoConversao: z.enum(['audio', 'video']).optional(),
      disponibilizarOriginal: z.boolean().optional(),
      percentualResumo: z.number().int().min(0).max(100).optional(),
      resumoGerado: z.string().optional(),
      resumoConfirmado: z.boolean().optional(),
      iaConfig: z.any().optional(),
      iaConversoes: z.array(z.enum(['texto', 'audio', 'video'])).optional(),
      colaboradorVe: z.array(z.enum(['texto', 'audio', 'video'])).optional(),
      questoes: z.array(z.object({
        pergunta: z.string().min(1),
        tipo: z.enum(['multipla-escolha', 'descritiva']),
        tiposResposta: z.array(z.enum(['multipla-escolha', 'descritiva', 'checkbox', 'audio', 'video'])).default([]),
        alternativas: z.array(z.string()).optional(),
        alternativaCorreta: z.number().int().optional(),
        order: z.number().int().default(0),
      })).optional(),
      ordemObrigatoria: z.boolean().optional(),
      publicoTipo: z.enum(['todo-time', 'colaboradores-especificos', 'por-departamento']).optional(),
      colaboradoresSelecionados: z.array(z.string()).optional(),
      questoesObrigatorias: z.boolean().optional(),
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
      ganhosAtivos: z.boolean().optional(),
      xp: z.number().int().min(0).optional(),
      estrelas: z.number().int().min(0).optional(),
    }).parse(request.body)

    const existing = await prisma.training.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError('Training', id)

    const contentFiles = body.conteudoArquivos?.length
      ? body.conteudoArquivos
      : (body.conteudoArquivo ? [body.conteudoArquivo] : undefined)

    const startDate = normalizeDate(body.dataInicio)
    const endDate = normalizeDate(body.dataFim)
    if (startDate && endDate && endDate < startDate) {
      return reply.code(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'dataFim must be >= dataInicio',
          statusCode: 422,
        },
      })
    }

    const shouldClearCampaign = body.vinculadoCampanha === false
    const nextCampaignId = shouldClearCampaign
      ? null
      : (body.campanhaId ?? undefined)

    const updateData: any = {
      title: body.titulo,
      description: body.descricao,
      coverType: body.capa?.tipo,
      coverUrl: body.capa?.valor,
      primaryColor: body.corPrincipal,
      campaignId: nextCampaignId,
      contentOrigin: body.conteudoOrigem ? contentOriginMap[body.conteudoOrigem] : undefined,
      contentText: body.conteudoTexto,
      contentFiles,
      noAssessment: body.semAvaliacao,
      convertContent: body.converterConteudo,
      conversionType: body.tipoConversao ? contentFormatMap[body.tipoConversao] : undefined,
      allowOriginal: body.disponibilizarOriginal,
      summaryPercent: body.percentualResumo,
      summaryText: body.resumoGerado,
      summaryConfirmed: body.resumoConfirmado,
      aiConfig: body.iaConfig,
      aiConversions: body.iaConversoes ? mapEnumArray(body.iaConversoes, contentFormatMap) : undefined,
      visibleFormats: body.colaboradorVe ? mapEnumArray(body.colaboradorVe, contentFormatMap) : undefined,
      questionsRequired: body.questoesObrigatorias,
      requireSequential: body.ordemObrigatoria,
      audienceType: body.publicoTipo ? audienceTypeMap[body.publicoTipo] : undefined,
      audienceIds: body.colaboradoresSelecionados,
      startDate,
      endDate,
      rewardsActive: body.ganhosAtivos,
      rewardXP: body.xp,
      rewardStars: body.estrelas,
    }

    const training = await prisma.$transaction(async (tx) => {
      if (body.questoes) {
        await tx.trainingQuestion.deleteMany({ where: { trainingId: id } })
      }

      return tx.training.update({
        where: { id },
        data: {
          ...updateData,
          questions: body.questoes
            ? {
                create: body.questoes.map((q, idx) => ({
                  question: q.pergunta,
                  type: questionTypeMap[q.tipo],
                  answerTypes: mapEnumArray(q.tiposResposta, answerTypeMap),
                  options: q.alternativas ?? [],
                  correctOption: q.alternativaCorreta,
                  order: q.order ?? idx,
                })),
              }
            : undefined,
        },
        include: { questions: { orderBy: { order: 'asc' } } },
      })
    })

    return reply.send({ data: training })
  })

  // DELETE /trainings/:id (super_admin) - soft delete
  fastify.delete('/:id', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Trainings'], summary: 'Delete training' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    await prisma.training.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    return reply.code(204).send()
  })
}

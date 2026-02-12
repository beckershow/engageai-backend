import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'
import { awardXpUseCase, XP_REWARDS, STAR_REWARDS } from '../../../application/gamification/award-xp.usecase.js'
import { NotFoundError, ForbiddenError } from '../../../shared/errors/app-error.js'
import { getPaginationParams, buildPaginationMeta } from '../../../shared/utils/pagination.js'

export async function coursesRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /courses
  fastify.get('/', {
    preHandler: [authenticate],
    schema: { tags: ['Courses'], summary: 'List courses' },
  }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
      category: z.string().optional(),
      level: z.string().optional(),
    }).parse(request.query)

    const { skip, take, page, limit } = getPaginationParams(query)

    const where: any = { isActive: true }
    if (query.category) where.category = query.category
    if (query.level) where.level = query.level

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, title: true, description: true, category: true, level: true,
          rewardXP: true, hasCertificate: true, thumbnailUrl: true,
          creator: { select: { id: true, nome: true } },
          _count: { select: { lessons: true } },
        },
      }),
      prisma.course.count({ where }),
    ])

    // Add user progress for each course
    const courseIds = courses.map(c => c.id)
    const userProgress = await prisma.courseProgress.findMany({
      where: { courseId: { in: courseIds }, userId: request.user.id },
      select: { courseId: true, progress: true, completedAt: true },
    })
    const progressMap = new Map(userProgress.map(p => [p.courseId, p]))

    const coursesWithProgress = courses.map(c => ({
      ...c,
      userProgress: progressMap.get(c.id) ?? null,
    }))

    return reply.send({ data: coursesWithProgress, meta: buildPaginationMeta(total, page, limit) })
  })

  // GET /courses/:id
  fastify.get('/:id', {
    preHandler: [authenticate],
    schema: { tags: ['Courses'], summary: 'Get course by ID' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        lessons: { orderBy: { order: 'asc' } },
        creator: { select: { id: true, nome: true } },
        _count: { select: { progress: true } },
      },
    })
    if (!course) throw new NotFoundError('Course', id)

    const userProgress = await prisma.courseProgress.findUnique({
      where: { courseId_userId: { courseId: id, userId: request.user.id } },
    })

    return reply.send({ data: { ...course, userProgress } })
  })

  // POST /courses (gestor+)
  fastify.post('/', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Courses'], summary: 'Create course (gestor+)' },
  }, async (request, reply) => {
    const body = z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      category: z.enum(['lideranca', 'tecnologia', 'comunicacao', 'vendas', 'operacoes', 'produto', 'rh', 'financeiro', 'outros']),
      level: z.enum(['iniciante', 'intermediario', 'avancado']),
      rewardXP: z.number().int().min(0).default(100),
      hasCertificate: z.boolean().default(false),
      thumbnailUrl: z.string().url().optional(),
      lessons: z.array(z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        type: z.enum(['video', 'reading', 'quiz', 'practical']),
        contentUrl: z.string().optional(),
        duration: z.number().int().optional(),
        order: z.number().int().default(0),
        rewardXP: z.number().int().default(0),
      })).default([]),
    }).parse(request.body)

    const { lessons, ...courseData } = body
    const course = await prisma.course.create({
      data: {
        ...courseData,
        creatorId: request.user.id,
        lessons: { create: lessons },
      },
      include: { lessons: true },
    })

    return reply.code(201).send({ data: course })
  })

  // POST /courses/:id/start
  fastify.post('/:id/start', {
    preHandler: [authenticate],
    schema: { tags: ['Courses'], summary: 'Start course' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const course = await prisma.course.findUnique({ where: { id } })
    if (!course) throw new NotFoundError('Course', id)

    const existing = await prisma.courseProgress.findUnique({
      where: { courseId_userId: { courseId: id, userId: request.user.id } },
    })
    if (existing) return reply.send({ data: existing })

    const progress = await prisma.courseProgress.create({
      data: {
        courseId: id,
        userId: request.user.id,
        completedLessons: [],
        progress: 0,
      },
    })

    return reply.code(201).send({ data: progress })
  })

  // POST /courses/:id/lessons/:lessonId/complete
  fastify.post('/:id/lessons/:lessonId/complete', {
    preHandler: [authenticate],
    schema: { tags: ['Courses'], summary: 'Complete a lesson' },
  }, async (request, reply) => {
    const { id, lessonId } = z.object({ id: z.string(), lessonId: z.string() }).parse(request.params)

    const course = await prisma.course.findUnique({
      where: { id },
      include: { lessons: { select: { id: true, rewardXP: true } } },
    })
    if (!course) throw new NotFoundError('Course', id)

    const lesson = course.lessons.find(l => l.id === lessonId)
    if (!lesson) throw new NotFoundError('Lesson', lessonId)

    let progress = await prisma.courseProgress.findUnique({
      where: { courseId_userId: { courseId: id, userId: request.user.id } },
    })

    if (!progress) {
      progress = await prisma.courseProgress.create({
        data: { courseId: id, userId: request.user.id, completedLessons: [], progress: 0 },
      })
    }

    if (progress.completedLessons.includes(lessonId)) {
      return reply.send({ data: progress, message: 'Lesson already completed' })
    }

    const completedLessons = [...progress.completedLessons, lessonId]
    const progressPct = Math.round((completedLessons.length / course.lessons.length) * 100)
    const isCompleted = progressPct === 100

    const updated = await prisma.courseProgress.update({
      where: { id: progress.id },
      data: {
        completedLessons,
        progress: progressPct,
        completedAt: isCompleted ? new Date() : null,
      },
    })

    // Award XP for lesson
    const lessonXp = lesson.rewardXP || 0
    if (lessonXp > 0) {
      await awardXpUseCase({
        userId: request.user.id,
        userRole: request.user.role,
        action: 'completar_treinamento',
        xp: lessonXp,
        context: { courseId: id, lessonId },
      })
    }

    // Award XP for completing the whole course
    if (isCompleted) {
      await awardXpUseCase({
        userId: request.user.id,
        userRole: request.user.role,
        action: 'completar_treinamento',
        xp: course.rewardXP,
        stars: STAR_REWARDS.completar_treinamento,
        context: { courseId: id, courseCompleted: true },
      })
    }

    return reply.send({ data: updated, courseCompleted: isCompleted })
  })

  // GET /courses/:id/certificate
  fastify.get('/:id/certificate', {
    preHandler: [authenticate],
    schema: { tags: ['Courses'], summary: 'Get course certificate' },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const progress = await prisma.courseProgress.findUnique({
      where: { courseId_userId: { courseId: id, userId: request.user.id } },
      include: { course: { select: { title: true, hasCertificate: true } } },
    })

    if (!progress || !progress.completedAt) {
      throw new ForbiddenError('Course not completed')
    }
    if (!progress.course.hasCertificate) {
      throw new ForbiddenError('Course does not offer a certificate')
    }

    return reply.send({
      data: {
        courseId: id,
        courseTitle: progress.course.title,
        userId: request.user.id,
        completedAt: progress.completedAt,
        certificateUrl: progress.certificateUrl,
      },
    })
  })
}

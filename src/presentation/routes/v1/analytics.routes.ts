import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../infrastructure/database/prisma.client.js'
import { authenticate } from '../../middlewares/authenticate.js'
import { authorize } from '../../middlewares/authorize.js'

export async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /analytics/platform - overall platform stats (admin)
  fastify.get('/platform', {
    preHandler: [authenticate, authorize(['super_admin'])],
    schema: { tags: ['Analytics'], summary: 'Platform-wide stats' },
  }, async (_request, reply) => {
    const [
      totalUsers,
      activeColaboradores,
      totalFeedbacks,
      totalSurveyResponses,
      totalCoursesCompleted,
      totalEventsAttended,
      totalFeedPosts,
      avgMood,
    ] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { role: 'colaborador', isActive: true } }),
      prisma.feedback.count(),
      prisma.surveyResponse.count(),
      prisma.courseProgress.count({ where: { completedAt: { not: null } } }),
      prisma.eventParticipation.count({ where: { attended: true } }),
      prisma.feedPost.count({ where: { deletedAt: null } }),
      prisma.moodEntry.aggregate({ _avg: { mood: true } }),
    ])

    return reply.send({
      data: {
        totalUsers,
        activeColaboradores,
        totalFeedbacks,
        totalSurveyResponses,
        totalCoursesCompleted,
        totalEventsAttended,
        totalFeedPosts,
        averageMood: avgMood._avg.mood ? Math.round(avgMood._avg.mood * 10) / 10 : null,
      },
    })
  })

  // GET /analytics/engagement
  fastify.get('/engagement', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Analytics'], summary: 'Engagement analytics (gestor+)' },
  }, async (request, reply) => {
    const query = z.object({ days: z.coerce.number().default(30) }).parse(request.query)
    const since = new Date()
    since.setDate(since.getDate() - query.days)

    const isAdmin = request.user.role === 'super_admin'
    const teamFilter = isAdmin
      ? { role: 'colaborador' as const, isActive: true }
      : { managerId: request.user.id, isActive: true }

    const teamMembers = await prisma.user.findMany({ where: teamFilter, select: { id: true } })
    const teamIds = teamMembers.map(m => m.id)

    const [
      feedPosts,
      feedbacksSent,
      surveyResponses,
      moodEntries,
      coursesCompleted,
      eventsAttended,
    ] = await Promise.all([
      prisma.feedPost.count({ where: { userId: { in: teamIds }, createdAt: { gte: since }, deletedAt: null } }),
      prisma.feedback.count({ where: { fromUserId: { in: teamIds }, createdAt: { gte: since } } }),
      prisma.surveyResponse.count({ where: { userId: { in: teamIds }, submittedAt: { gte: since } } }),
      prisma.moodEntry.count({ where: { userId: { in: teamIds }, createdAt: { gte: since } } }),
      prisma.courseProgress.count({ where: { userId: { in: teamIds }, completedAt: { gte: since } } }),
      prisma.eventParticipation.count({ where: { userId: { in: teamIds }, attended: true, registeredAt: { gte: since } } }),
    ])

    return reply.send({
      data: {
        teamSize: teamIds.length,
        period: query.days,
        feedPosts,
        feedbacksSent,
        surveyResponses,
        moodEntries,
        coursesCompleted,
        eventsAttended,
        engagementScore: Math.min(100, Math.round(
          ((feedPosts + feedbacksSent + surveyResponses + moodEntries) / (teamIds.length * query.days / 7)) * 100
        )),
      },
    })
  })

  // GET /analytics/mood
  fastify.get('/mood', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Analytics'], summary: 'Mood analytics (gestor+)' },
  }, async (request, reply) => {
    const query = z.object({ days: z.coerce.number().default(30) }).parse(request.query)
    const since = new Date()
    since.setDate(since.getDate() - query.days)
    const sinceStr = since.toISOString().split('T')[0]

    const isAdmin = request.user.role === 'super_admin'
    const teamFilter = isAdmin ? { isActive: true } : { managerId: request.user.id, isActive: true }
    const teamMembers = await prisma.user.findMany({ where: teamFilter, select: { id: true } })
    const teamIds = teamMembers.map(m => m.id)

    const entries = await prisma.moodEntry.findMany({
      where: { userId: { in: teamIds }, date: { gte: sinceStr } },
      select: { date: true, mood: true, userId: true },
      orderBy: { date: 'asc' },
    })

    // Group by date
    const byDate: Record<string, { sum: number; count: number }> = {}
    entries.forEach(e => {
      if (!byDate[e.date]) byDate[e.date] = { sum: 0, count: 0 }
      byDate[e.date].sum += e.mood
      byDate[e.date].count += 1
    })

    const trend = Object.entries(byDate).map(([date, { sum, count }]) => ({
      date,
      average: Math.round((sum / count) * 10) / 10,
      count,
    }))

    const overall = entries.length > 0
      ? Math.round((entries.reduce((acc, e) => acc + e.mood, 0) / entries.length) * 10) / 10
      : null

    return reply.send({ data: { trend, overall, totalEntries: entries.length } })
  })

  // GET /analytics/training
  fastify.get('/training', {
    preHandler: [authenticate, authorize(['gestor'])],
    schema: { tags: ['Analytics'], summary: 'Training analytics' },
  }, async (request, reply) => {
    const isAdmin = request.user.role === 'super_admin'
    const teamFilter = isAdmin ? { isActive: true } : { managerId: request.user.id, isActive: true }
    const teamMembers = await prisma.user.findMany({ where: teamFilter, select: { id: true } })
    const teamIds = teamMembers.map(m => m.id)

    const [inProgress, completed, byCategory] = await Promise.all([
      prisma.courseProgress.count({ where: { userId: { in: teamIds }, completedAt: null } }),
      prisma.courseProgress.count({ where: { userId: { in: teamIds }, completedAt: { not: null } } }),
      prisma.courseProgress.groupBy({
        by: ['courseId'],
        where: { userId: { in: teamIds }, completedAt: { not: null } },
        _count: true,
      }),
    ])

    return reply.send({ data: { teamSize: teamIds.length, coursesInProgress: inProgress, coursesCompleted: completed } })
  })
}

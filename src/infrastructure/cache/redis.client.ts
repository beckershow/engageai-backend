import Redis from 'ioredis'
import { env } from '../../config/env.js'

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  lazyConnect: true,
  retryStrategy: (times: number) => {
    if (times > 3) return null // stop retrying
    return Math.min(times * 1000, 3000)
  },
})

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message)
})

redis.on('connect', () => {
  console.log('[Redis] Connected')
})

// Leaderboard keys
export const LEADERBOARD_KEY = 'engageai:leaderboard:global'
export const LEADERBOARD_DEPT_PREFIX = 'engageai:leaderboard:dept:'
export const LEADERBOARD_TTL = 300 // 5 minutes

export async function updateLeaderboardScore(userId: string, xp: number): Promise<void> {
  await redis.zadd(LEADERBOARD_KEY, xp, userId)
}

export async function getLeaderboard(offset = 0, limit = 50): Promise<Array<{ userId: string; xp: number; rank: number }>> {
  const results = await redis.zrevrangebyscore(
    LEADERBOARD_KEY,
    '+inf',
    '-inf',
    'WITHSCORES',
    'LIMIT',
    offset,
    limit,
  )

  const entries: Array<{ userId: string; xp: number; rank: number }> = []
  for (let i = 0; i < results.length; i += 2) {
    entries.push({
      userId: results[i],
      xp: parseFloat(results[i + 1]),
      rank: offset + Math.floor(i / 2) + 1,
    })
  }
  return entries
}

export async function getUserRank(userId: string): Promise<number | null> {
  const rank = await redis.zrevrank(LEADERBOARD_KEY, userId)
  return rank !== null ? rank + 1 : null
}

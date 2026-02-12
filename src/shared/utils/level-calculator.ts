// XP required to reach each level (cumulative thresholds)
const LEVEL_THRESHOLDS = [
  0,     // Level 1 start
  500,   // Level 2
  1500,  // Level 3
  3000,  // Level 4
  5000,  // Level 5
  7500,  // Level 6
  10500, // Level 7
  14000, // Level 8
  18000, // Level 9
  23000, // Level 10
]

export function calculateLevel(xp: number): number {
  let level = 1
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) {
      level = i + 1
    } else {
      break
    }
  }
  return level
}

export function calculateXpForNextLevel(currentLevel: number): number {
  const nextLevelIndex = currentLevel // index = level (since LEVEL_THRESHOLDS[0] = level 1)
  if (nextLevelIndex >= LEVEL_THRESHOLDS.length) {
    // Max level reached
    return LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] + 5000
  }
  return LEVEL_THRESHOLDS[nextLevelIndex]
}

export function checkLevelUp(oldXp: number, newXp: number): { leveledUp: boolean; oldLevel: number; newLevel: number } {
  const oldLevel = calculateLevel(oldXp)
  const newLevel = calculateLevel(newXp)
  return {
    leveledUp: newLevel > oldLevel,
    oldLevel,
    newLevel,
  }
}

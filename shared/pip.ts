import { rng } from './rng'
import type { GameId, PipLevel } from './types'

export const PIP_NAMES: Record<PipLevel, string> = { easy: 'Nimo (Easy)', med: 'Nimo (Medium)', hard: 'Nimo (Hard)' }
export const PIP_ADDRESS = 'PIP-BOT'

/** Chance Nimo gets a trivia question right, and its answer time range in ms. */
export const PIP_TRIVIA: Record<PipLevel, { p: number; ms: [number, number] }> = {
  easy: { p: 0.45, ms: [6000, 13000] },
  med: { p: 0.7, ms: [4000, 10000] },
  hard: { p: 0.9, ms: [2500, 7000] },
}

const around = (r: ReturnType<typeof rng>, mean: number, spread: number) => Math.max(0, Math.round(mean + (r.next() * 2 - 1) * spread))

/** What Nimo scores in score-based games, derived from the shared seed so it is stable and checkable. */
export function pipScore(game: GameId, level: PipLevel, seed: string): { score: number; time: number } {
  const r = rng(`pip:${game}:${level}:${seed}`)
  const L = { easy: 0, med: 1, hard: 2 }[level]
  switch (game) {
    case 'solitaire':
      return { score: around(r, [6, 14, 24][L], [3, 4, 5][L]) * 10, time: 180000 }
    case 'sudoku': {
      if (level === 'hard') {
        const t = around(r, 210, 40) * 1000
        return { score: 43 + 50 + Math.max(0, 300 - t / 1000), time: t }
      }
      return { score: around(r, [20, 32][L], [6, 5][L]), time: 300000 }
    }
    case 'bubble':
      return { score: around(r, [600, 1400, 2400][L], [200, 300, 400][L]), time: 90000 }
    case 'word':
      return { score: around(r, [25, 45, 70][L], [8, 10, 12][L]), time: 60000 }
    case 'lastbite':
      return { score: around(r, [20, 32, 44][L], [6, 5, 4][L]), time: 90000 }
    default:
      return { score: 0, time: 0 }
  }
}

/** Games where the human plays an engine live and reports 1 / 0.5 / 0 */
export const ENGINE_GAMES: GameId[] = ['chess', 'pool']

export const GAME_DURATION_MS: Record<GameId, number> = {
  trivia: 5 * 17000,
  solitaire: 180000,
  chess: 8 * 60000,
  pool: 6 * 60000,
  sudoku: 300000,
  bubble: 90000,
  word: 60000,
  lastbite: 90000,
  splat: 180000,
}

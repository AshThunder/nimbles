// Server-side replay checks for the skill games. One entry per game that sends a move log.
import type { GameId } from './types'
import { replayDarts } from './darts'
import { replayBlocks } from './blocks'
import { replaySpeedMath } from './speedmath'
import { replaySpider } from './spider'
import { replayBowling } from './bowling'
import { replayCarrom } from './carrom'
import { replayGhost } from './ghost'
import { replayBlitz } from './blitz'
import { replayDominoes } from './dominoes'

export type SkillReplay = { ok: true; score: number; lastAt: number; detail: Record<string, unknown> } | { ok: false; reason: string }

/** The key of the move log inside the result detail, and the replayer for it */
export const REPLAYS: Partial<Record<GameId, { key: string; run: (seed: string, log: unknown, limitMs: number) => SkillReplay }>> = {
  darts: { key: 'throws', run: replayDarts },
  blocks: { key: 'moves', run: replayBlocks },
  spider: { key: 'moves', run: replaySpider },
  dominoes: { key: 'moves', run: replayDominoes },
  blitz: { key: 'moves', run: replayBlitz },
  bowling: { key: 'throws', run: replayBowling },
  ghost: { key: 'run', run: replayGhost },
  carrom: { key: 'shots', run: replayCarrom },
  speedmath: { key: 'answers', run: replaySpeedMath },
}

import type { GameId } from '../../../shared/types'
import type { GameMod } from './common'
import { trivia } from './trivia'
import { solitaire } from './solitaire'
import { bubble } from './bubble'
import { chess } from './chess'
import { pool } from './pool'
import { chessLive } from './chessLive'
import { poolLive } from './poolLive'
import { word } from './word'
import { sudokuGame } from './sudoku'

export const MODS: Partial<Record<GameId, GameMod>> = {
  trivia,
  word,
  bubble,
  chess,
  pool,
  solitaire,
  sudoku: sudokuGame(9),
  lastbite: sudokuGame(4),
}
/** Two people playing live: the server runs the game, the phone only sends moves */
export const LIVE_MODS: Partial<Record<GameId, GameMod>> = { chess: chessLive, pool: poolLive }
export const BUILT = new Set(Object.keys(MODS))

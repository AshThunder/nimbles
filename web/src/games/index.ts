import type { GameId } from '../../../shared/types'
import type { GameMod } from './common'
import { trivia } from './trivia'
import { solitaire } from './solitaire'
import { sudokuGame } from './sudoku'

export const MODS: Partial<Record<GameId, GameMod>> = {
  trivia,
  solitaire,
  sudoku: sudokuGame(9),
  lastbite: sudokuGame(4),
}
export const BUILT = new Set(Object.keys(MODS))

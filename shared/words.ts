import { rng } from './rng'

/** Points per word length. Longer words are worth much more than two short ones. */
export const WORD_POINTS: Record<number, number> = { 3: 3, 4: 5, 5: 8, 6: 12, 7: 20 }
export const wordPoints = (w: string) => WORD_POINTS[w.length] ?? 0

/** Seven letters from a real seven-letter word, shuffled, so everyone gets the same rack and a 7-letter word always exists. */
export function wordRack(seed: string, sevens: readonly string[]): string[] {
  const r = rng('word:' + seed)
  return r.shuffle(r.pick(sevens).split(''))
}

export function canMake(word: string, rack: readonly string[]): boolean {
  const left = [...rack]
  for (const ch of word) {
    const i = left.indexOf(ch)
    if (i < 0) return false
    left.splice(i, 1)
  }
  return true
}

export function scoreWords(words: unknown, rack: readonly string[], dict: ReadonlySet<string>): { score: number; valid: string[] } {
  const seen = new Set<string>()
  if (Array.isArray(words)) for (const w of words) if (typeof w === 'string' && w.length >= 3 && w.length <= 7 && dict.has(w) && canMake(w, rack)) seen.add(w)
  const valid = [...seen]
  return { score: valid.reduce((s, w) => s + wordPoints(w), 0), valid }
}

export const sevensOf = (list: readonly string[]) => list.filter((w) => w.length === 7)

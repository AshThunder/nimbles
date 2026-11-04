import { GAME_DURATION_MS } from '../../../shared/pip'
import { scoreWords, sevensOf, wordPoints, wordRack } from '../../../shared/words'
import { $, esc, ic, sfx, buzz } from '../lib'
import { clock, finishBtn, setScores, strip, wireFinish, type GameMod } from './common'

let dictP: Promise<string[]> | undefined
const loadDict = () => (dictP ??= fetch('/words/dict.txt').then((r) => r.text()).then((t) => t.split('\n').filter(Boolean)))

export const word: GameMod = (ctx) => {
  const total = GAME_DURATION_MS.word
  let done = false
  let rack: string[] = []
  let order: number[] = [] // indexes of rack tiles in the current word
  const found: string[] = []
  let dict = new Set<string>()
  let clk: ReturnType<typeof clock> | undefined
  const score = () => scoreWords(found, rack, dict).score

  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Word Rush</div><span class="tmr" id="tm">1:00</span></div>
  <div class="scroll" style="gap:12px">${strip(ctx.m, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div><div id="wr" class="wr"></div>${finishBtn()}</div>`
  wireFinish(ctx.root, () => void end())
  const wr = $('#wr', ctx.root)!
  wr.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--muted)">Loading letters…</div>'

  const draw = () => {
    const cur = order.map((i) => rack[i]).join('')
    wr.innerHTML = `<div class="wcur" id="wcur">${cur ? [...cur].map((c) => `<span>${c.toUpperCase()}</span>`).join('') : '<em>Tap letters to build a word</em>'}</div>
      <div class="wtiles">${rack.map((c, i) => `<button class="wt ${order.includes(i) ? 'used' : ''}" data-i="${i}" aria-pressed="${order.includes(i)}">${c.toUpperCase()}</button>`).join('')}</div>
      <div class="wact"><button class="btn ghost" data-w="shuffle">${ic('refresh-cw', 's20')}Shuffle</button><button class="btn ghost" data-w="del">${ic('eraser', 's20')}Delete</button><button class="btn gold" data-w="enter">${ic('check', 's20')}Enter</button></div>
      <div class="lab" style="margin:0">Your words<small>${found.length} found, 3 to 7 letters</small></div>
      <div class="wfound">${found.map((w) => `<span class="wf"><b>${esc(w.toUpperCase())}</b><i>+${wordPoints(w)}</i></span>`).join('') || '<em style="color:var(--muted);font-size:14px">None yet. A 7-letter word is hiding in there</em>'}</div>`
  }
  const bad = (msg: string) => {
    sfx('ui/wrong')
    buzz(30)
    const el = $('#wcur', ctx.root)
    el?.classList.remove('shake')
    void el?.offsetWidth
    el?.classList.add('shake')
    const first = el?.querySelector('em') ?? null
    void first
    order = []
    setTimeout(() => {
      if (!done) draw()
    }, 350)
    void msg
  }
  const enter = () => {
    const w = order.map((i) => rack[i]).join('')
    if (w.length < 3) return bad('short')
    if (found.includes(w)) return bad('dup')
    if (!dict.has(w)) return bad('nope')
    found.push(w)
    order = []
    sfx(w.length >= 6 ? 'reward/bonus' : 'ui/correct')
    buzz(15)
    const s = score()
    setScores(ctx.root, ctx.m, ctx.me, { [ctx.me]: s })
    ctx.progress(s)
    draw()
    if (w.length === 7) sfx('reward/xp')
  }
  const press = (i: number) => {
    if (done || order.includes(i)) return
    order.push(i)
    sfx('ui/tile', 0.6)
    draw()
  }
  const act = (e: Event) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-i],[data-w]')
    if (!t || done) return
    if (t.dataset.i) return press(Number(t.dataset.i))
    const w = t.dataset.w
    if (w === 'enter') enter()
    else if (w === 'del') (order.pop(), sfx('ui/back', 0.5), draw())
    else if (w === 'shuffle') {
      const used = order.map((i) => rack[i])
      void used
      const idx = rack.map((_, i) => i)
      for (let i = idx.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0
        ;[idx[i], idx[j]] = [idx[j], idx[i]]
      }
      const nr = idx.map((i) => rack[i])
      order = order.map((o) => idx.indexOf(o))
      rack = nr
      sfx('game/card-shuffle', 0.5)
      draw()
    }
  }
  wr.addEventListener('click', act)
  const key = (e: KeyboardEvent) => {
    if (done || !rack.length) return
    if (e.key === 'Enter') return enter()
    if (e.key === 'Backspace') return (order.pop(), draw())
    const c = e.key.toLowerCase()
    if (c.length === 1 && c >= 'a' && c <= 'z') {
      const i = rack.findIndex((x, k) => x === c && !order.includes(k))
      if (i >= 0) press(i)
    }
  }
  window.addEventListener('keydown', key)

  void loadDict().then((list) => {
    if (done) return
    dict = new Set(list)
    rack = wordRack(ctx.m.seed!, sevensOf(list))
    draw()
  })
  clk = clock(ctx.m, $('#tm', ctx.root), $('#tb', ctx.root), () => void end(), total)
  const end = async () => {
    if (done) return
    done = true
    clk?.stop()
    const s = score()
    sfx(s > 0 ? 'reward/win-big' : 'reward/lose')
    await ctx.finish({ score: s, time: total - (clk?.left() ?? 0), detail: { words: found } })
  }
  return {
    update: (m) => setScores(ctx.root, m, ctx.me, { [ctx.me]: score() }),
    destroy: () => {
      done = true
      clk?.stop()
      window.removeEventListener('keydown', key)
    },
  }
}

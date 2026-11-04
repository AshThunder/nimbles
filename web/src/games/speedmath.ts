import { GAME_DURATION_MS } from '../../../shared/pip'
import { smQuestion } from '../../../shared/speedmath'
import { $, ic, sfx, buzz } from '../lib'
import { clock, finishBtn, setScores, strip, wireFinish, type GameMod } from './common'

export const speedmath: GameMod = (ctx) => {
  const total = GAME_DURATION_MS.speedmath
  const seed = ctx.m.seed!
  let done = false
  let score = 0
  let streak = 0
  let i = 0
  let typed = ''
  let lastAt = -Infinity
  const log: [number, number][] = []
  const t0 = performance.now()
  const now = () => Math.round(performance.now() - t0)

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'go']
  ctx.root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl">Speed Math</div><span class="tmr" id="tm">1:00</span></div>
  <div class="scroll" style="gap:10px">${strip(ctx.m, ctx.me)}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div></div>
  <div class="card smq" id="sq"><div class="smt" id="qt"></div><div class="sma" id="qa"></div></div>
  <div class="row" style="justify-content:space-between;font-size:14px;color:var(--ink2)"><span id="st"></span><span id="ct"></span></div>
  <div class="kp">${keys.map((k) => (k === 'del' ? `<button class="kb" data-k="del" aria-label="Delete">${ic('eraser', 's20')}</button>` : k === 'go' ? `<button class="kb go" data-k="go" aria-label="Answer">${ic('check', 's20')}</button>` : `<button class="kb" data-k="${k}">${k}</button>`)).join('')}</div>${finishBtn()}</div>`
  wireFinish(ctx.root, () => void end())

  const show = () => {
    $('#qt', ctx.root)!.textContent = smQuestion(seed, i).text + ' = ?'
    $('#qa', ctx.root)!.textContent = typed || ' '
    $('#st', ctx.root)!.textContent = streak >= 2 ? `Streak ${streak}` : 'Same sums for everyone'
    $('#ct', ctx.root)!.textContent = `${log.length} answered`
  }
  const flash = (ok: boolean) => {
    const el = $('#sq', ctx.root)!
    el.classList.remove('ok', 'no')
    void el.offsetWidth
    el.classList.add(ok ? 'ok' : 'no')
  }
  const submit = () => {
    if (done || !typed) return
    const t = now()
    if (t - lastAt < 350) return
    lastAt = t
    const ans = Number(typed)
    log.push([ans, t])
    if (ans === smQuestion(seed, i).answer) {
      score += 10 + Math.min(streak, 10)
      streak++
      sfx('ui/correct', 0.6)
      buzz(10)
      flash(true)
    } else {
      score = Math.max(0, score - 5)
      streak = 0
      sfx('ui/wrong', 0.6)
      buzz(30)
      flash(false)
    }
    i++
    typed = ''
    setScores(ctx.root, ctx.m, ctx.me, { [ctx.me]: score })
    ctx.progress(score)
    show()
  }
  const press = (k: string) => {
    if (done) return
    if (k === 'go') return submit()
    if (k === 'del') typed = typed.slice(0, -1)
    else if (typed.length < 4) typed += k
    show()
  }
  ctx.root.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.addEventListener('click', () => press(b.dataset.k!)))
  const onKey = (e: KeyboardEvent) => {
    if (/^\d$/.test(e.key)) press(e.key)
    else if (e.key === 'Backspace') press('del')
    else if (e.key === 'Enter') press('go')
  }
  document.addEventListener('keydown', onKey)
  show()
  const clk = clock(ctx.m, $('#tm', ctx.root), $('#tb', ctx.root), () => void end(), total)
  const end = async () => {
    if (done) return
    done = true
    document.removeEventListener('keydown', onKey)
    clk.stop()
    sfx('reward/win-big')
    await ctx.finish({ score, time: Math.min(total, now()), detail: { answers: log } })
  }
  return {
    update: (m) => setScores(ctx.root, m, ctx.me, { [ctx.me]: score }),
    destroy: () => {
      done = true
      document.removeEventListener('keydown', onKey)
      clk.stop()
    },
  }
}

import { api, type MatchView } from '../api'
import { avatar, esc, ic, lvBadge, pipImg, sfx, buzz, $, $$, confetti, sleep } from '../lib'
import { others, meOf, type GameMod } from './common'

const L = ['A', 'B', 'C', 'D']
const QMS = 15000

export const trivia: GameMod = (ctx) => {
  let m = ctx.m
  const root = ctx.root
  // the server reveals one question at a time: later ones arrive with each answer (r.next)
  const qs = [...(m.trivia?.questions ?? [])]
  const total = (m.trivia as any)?.count ?? qs.length
  let idx = m.trivia?.mine?.length ?? 0
  let t0 = Date.now()
  let timer: ReturnType<typeof setInterval> | undefined
  let locked = false
  let dead = false
  let myScore = m.trivia?.mine?.reduce((s, a) => s + a.points, 0) ?? 0
  let pipScore = m.trivia?.pip?.reduce((s, a) => s + a.points, 0) ?? 0
  let streak = 0

  const opp = () => others(m, ctx.me)[0]
  const oppScore = () => (opp()?.isBot ? pipScore : opp()?.progress ?? 0)
  const arena = () => {
    const me = meOf(m, ctx.me)
    const o = opp()
    return `<div class="arena"><div class="l"></div><div class="r"></div>
      <div class="pl a">${avatar(me.player.avatar)}<span class="nm">You</span><span class="ascore" id="s-me">${myScore}</span></div>
      <div class="pl b">${o?.isBot ? pipImg('cool') : avatar(o?.player.avatar ?? 'ada')}<span class="nm">${esc((o?.player.name ?? 'Opponent').split(' ')[0])}</span><span class="ascore" id="s-opp">${oppScore()}</span></div>
      <div class="vs">VS</div></div>`
  }
  const shell = () => {
    root.innerHTML = `<div class="top"><span style="width:40px"></span><div class="ttl" id="qn"></div><span style="width:40px"></span></div>
    <div class="scroll" style="gap:12px">${arena()}<div class="tbar"><div class="pbar"><i id="tb" style="width:100%"></i></div><span class="tmr" id="tm">0:15</span></div><div id="qa" style="display:flex;flex-direction:column;gap:12px"></div></div>
    <div class="foot" style="padding-top:10px" id="ft"></div>`
  }
  const pipSay = (mood: string, html: string) => {
    $('#ft', root)!.innerHTML = `<div class="pipr" style="gap:8px">${pipImg(mood)}<div class="bubble" style="padding:6px 12px;font-size:13px">${html}</div></div>`
  }
  const bump = (id: string, v: number) => {
    const el = $('#' + id, root)
    if (!el) return
    el.textContent = String(v)
    el.classList.remove('pop')
    void (el as HTMLElement).offsetWidth
    el.classList.add('pop')
  }

  const showQ = () => {
    if (dead) return
    const q = qs[idx]
    if (!q || !q.q) {
      // not revealed yet (the screen was rebuilt mid-game): fetch it, the server stamps the time it was shown
      void api.match(m.id).then((v) => { m = v; const nq = v.trivia?.questions?.[idx]; if (nq?.q) { qs[idx] = nq; showQ() } }).catch(() => {})
      return
    }
    locked = false
    t0 = Date.now()
    $('#qn', root)!.textContent = `Question ${idx + 1} of ${total}`
    $('#qa', root)!.innerHTML = `<div class="q"><div class="t">${esc(q.q)}</div><div class="src">${ic('shield-check', 's16')}${m.trivia?.verified ? 'Nimo fact-checked this' : esc(m.trivia?.source === 'bank' ? 'From the Nimo question bank' : 'Written by Nimo')}${q.category ? ' · ' + esc(q.category) : ''}</div></div>
      <div style="display:flex;flex-direction:column;gap:10px">${q.options.map((o, i) => `<button class="ans" data-i="${i}"><span class="kc">${L[i]}</span><span>${esc(o)}</span></button>`).join('')}</div>`
    pipSay('think', idx === 0 ? '<b>Same questions, same clock.</b> Faster correct answers score more' : 'Next one. Stay sharp')
    clearInterval(timer)
    timer = setInterval(() => {
      const left = Math.max(0, QMS - (Date.now() - t0))
      const tm = $('#tm', root)
      if (tm) tm.textContent = '0:' + String(Math.ceil(left / 1000)).padStart(2, '0')
      const tb = $('#tb', root)
      if (tb) tb.style.width = (left / QMS) * 100 + '%'
      if (left <= 0 && !locked) void answer(-1)
    }, 100)
  }

  const answer = async (choice: number) => {
    if (locked || dead) return
    locked = true
    clearInterval(timer)
    const ms = Math.min(QMS, Date.now() - t0)
    $$('.ans', root).forEach((b) => b.classList.add('locked'))
    if (choice >= 0) $$('.ans', root)[choice]?.classList.add('on')
    let r: any
    try {
      r = await api.answer(m.id, idx, choice, ms)
    } catch (e: any) {
      pipSay('sad', esc(e.message))
      sfx('ui/error')
      locked = false
      return
    }
    if (dead) return
    const btns = $$('.ans', root)
    btns.forEach((b) => b.classList.remove('on'))
    btns[r.answer]?.classList.add('right')
    if (!r.correct && choice >= 0) btns[choice]?.classList.add('wrong')
    if (r.correct) {
      myScore += r.points
      streak++
      sfx('ui/correct')
      buzz(30)
      bump('s-me', myScore)
      pipSay(streak >= 3 ? 'cheer' : 'wow', `<b>+${r.points}.</b> ${r.points > 130 ? 'Lightning fast' : 'Nice one'}${streak >= 3 ? `, ${streak} in a row` : ''}`)
    } else {
      streak = 0
      sfx('ui/wrong')
      buzz([40, 40, 40])
      pipSay('sad', choice < 0 ? '<b>Time ran out.</b> Move fast on the next one' : '<b>Not that one.</b> Shake it off')
    }
    if (r.pip) {
      pipScore += r.pip.points
      bump('s-opp', pipScore)
    }
    if (r.fact) $('#qa', root)!.insertAdjacentHTML('beforeend', `<div class="fact">${ic('lightbulb', 's16')} ${esc(r.fact)}</div>`)
    await sleep(r.fact ? 1800 : 1100)
    if (dead) return
    idx++
    if (r.next) qs[idx] = r.next
    if (r.done || idx >= total) {
      pipSay('happy', 'All answered. Waiting for the final score…')
      await ctx.finish({ score: myScore, time: 0 })
      return
    }
    showQ()
  }

  shell()
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.ans')
    if (b && !locked) void answer(Number(b.dataset.i))
  })
  if (idx >= total) void ctx.finish({ score: myScore, time: 0 })
  else showQ()

  return {
    update(next: MatchView) {
      m = next
      const o = opp()
      if (o && !o.isBot) {
        const el = $('#s-opp', root)
        if (el && el.textContent !== String(o.progress ?? 0)) bump('s-opp', o.progress ?? 0)
      }
    },
    destroy() {
      dead = true
      clearInterval(timer)
    },
  }
}
export { confetti, lvBadge }

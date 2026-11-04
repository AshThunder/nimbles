import { api, type ChestView } from '../api'
import { actions, confetti, esc, ic, sfx, buzz, toast } from '../lib'
import { S, go, route } from '../state'
import { errBox, tabs, topbar } from '../ui'
import { badgeOf, cosmeticOf, type Contents } from '../../../shared/rewards'

const HOLD_MS = 1200

/** One line per item inside a chest. The same list is shown before and after opening. */
export const contentRows = (c: Contents, opened = false) => {
  const rows: string[] = [`<div class="crw"><span class="cic xp">${ic('sparkles', 's20')}</span><span class="nm"><b>+${c.xp} XP</b><span>Towards your next level</span></span></div>`]
  if (c.boost) rows.push(`<div class="crw"><span class="cic bst">${ic('trending-up', 's20')}</span><span class="nm"><b>+${c.boost.pct}% saver share</b><span>For ${c.boost.hours} hours, applies to the next daily payout${c.boost.hours > 24 ? 's' : ''}</span></span></div>`)
  if (c.badge) {
    const b = badgeOf(c.badge)
    rows.push(`<div class="crw"><span class="cic"><img src="/badges/${b.icon}.svg" alt="" width="32" height="32"></span><span class="nm"><b>${esc(b.name)} badge</b><span>${esc(b.why)}</span></span></div>`)
  }
  if (c.cosmetic) {
    const k = cosmeticOf(c.cosmetic)
    if (k) rows.push(`<div class="crw"><span class="cic sw" style="background:${k.tint};border-color:${k.color}"></span><span class="nm"><b>${esc(k.name)} ${k.kind === 'theme' ? 'table theme' : 'avatar frame'}</b><span>${opened ? 'Added to your style' : 'Yours to keep'}</span></span></div>`)
  }
  return rows.join('')
}

const ago = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

route('/chests', async (root) => {
  let data = await api.chests().catch(() => null)
  const draw = () => {
    const open = data?.chests.filter((c) => !c.openedAt) ?? []
    const done = data?.chests.filter((c) => c.openedAt) ?? []
    const row = (c: ChestView) => `<button class="card chr ${c.openedAt ? 'done' : ''}" data-act="chest" data-id="${esc(c.id)}"><img src="/badges/chest-${c.openedAt ? 'open' : 'closed'}.svg" alt="" width="56" height="56"><span class="nm"><b>${esc(c.title)}</b><span>${esc(c.why)}</span><em>${c.contents.xp} XP${c.contents.boost ? ' · +' + c.contents.boost.pct + '% share' : ''}${c.contents.badge ? ' · badge' : ''}${c.contents.cosmetic ? ' · style' : ''}</em></span><span class="chip ${c.openedAt ? '' : 'gold'}">${c.openedAt ? 'Opened ' + ago(c.openedAt) : 'Open'}</span></button>`
    const b = data?.boost
    root.innerHTML = `${topbar('Chests', 'back')}<div class="scroll" style="gap:12px">
      ${data ? '' : errBox('Could not load your chests')}
      <div class="card flat"><div class="tc"><div class="kv"><span>Saver boost active</span><b>${b && b.totalPct ? '+' + b.totalPct + '%' : 'None'}</b></div>
      <div class="kv"><span>From levels</span><b>+${b?.levelPct ?? 0}%</b></div><div class="kv"><span>From chests</span><b>${b?.chestPct ? '+' + b.chestPct + '%' : 'None'}</b></div></div></div>
      <div class="lab" style="margin:0">Ready to open<small>${open.length}</small></div>
      ${open.length ? open.map(row).join('') : `<div class="card flat" style="font-weight:600;line-height:22px">No chests waiting. Win a duel, keep your streak or level up to earn one. Nothing inside is random, and none of it is NIM.</div>`}
      ${done.length ? `<div class="lab" style="margin:0">Opened<small>${done.length}</small></div>${done.slice(0, 12).map(row).join('')}` : ''}
    </div>${tabs('Play')}`
  }
  draw()
  actions(root, { back: () => go('/'), chest: (el) => go('/chest/' + encodeURIComponent(el.dataset.id!)) })
})

route('/chest/:id', async (root, p) => {
  const id = decodeURIComponent(p.id)
  const data = await api.chests().catch(() => null)
  const c = data?.chests.find((x) => x.id === id)
  if (!c) {
    root.innerHTML = `${topbar('Chest', 'back')}<div class="scroll center">${errBox('That chest was not found')}</div>`
    actions(root, { back: () => go('/chests') })
    return
  }
  let phase: 'idle' | 'holding' | 'opening' | 'open' = c.openedAt ? 'open' : 'idle'
  let err = ''
  let raf = 0
  let t0 = 0
  const draw = () => {
    const isOpen = phase === 'open'
    root.innerHTML = `${topbar(c.title, 'back')}<div class="scroll center chs" style="gap:14px">
      <div class="chw ${phase}"><img class="chimg" src="/badges/chest-${isOpen ? 'open' : 'closed'}.svg" alt="" width="168" height="168"></div>
      <b class="cht">${isOpen ? 'Opened' : esc(c.why)}</b>
      <div class="card chin"><div class="lab" style="margin:0 0 10px">${isOpen ? 'You got' : 'Inside'}<small>Same for everyone, never NIM</small></div><div class="tc crs">${contentRows(c.contents, isOpen)}</div></div>
      ${err ? errBox(err) : ''}
    </div>
    <div class="foot">${isOpen
      ? `<button class="btn gold block" data-act="more">${ic('check', 's20')}Done</button>`
      : `<button class="btn block hold ${phase !== 'idle' ? 'on' : ''}" id="hold" ${phase === 'opening' ? 'disabled' : ''}><i class="hf" id="hf"></i><span class="hl">${ic('gift', 's20')}Hold to open</span></button>`}</div>`
  }
  const finish = async () => {
    phase = 'opening'
    draw()
    try {
      const r = await api.openChest(c.id)
      S.me = { ...S.me, ...r.profile }
      c.openedAt = Date.now()
      phase = 'open'
      sfx('reward/chest-open')
      buzz?.(40)
      draw()
      confetti(110)
    } catch (e: any) {
      err = e?.message || 'Could not open the chest'
      phase = 'idle'
      sfx('ui/error')
      draw()
      bind()
    }
  }
  const tick = () => {
    const f = Math.min(1, (performance.now() - t0) / HOLD_MS)
    const el = document.getElementById('hf')
    if (el) el.style.width = f * 100 + '%'
    if (f >= 1) { cancelAnimationFrame(raf); void finish(); return }
    raf = requestAnimationFrame(tick)
  }
  const start = (ev: Event) => {
    if (phase !== 'idle' || (ev instanceof KeyboardEvent && (ev.repeat || (ev.key !== ' ' && ev.key !== 'Enter')))) return
    ev.preventDefault()
    phase = 'holding'
    t0 = performance.now()
    root.querySelector('.chw')?.classList.add('holding')
    root.querySelector('#hold')?.classList.add('on')
    raf = requestAnimationFrame(tick)
  }
  const stop = () => {
    if (phase !== 'holding') return
    cancelAnimationFrame(raf)
    phase = 'idle'
    root.querySelector('.chw')?.classList.remove('holding')
    root.querySelector('#hold')?.classList.remove('on')
    const el = document.getElementById('hf')
    if (el) el.style.width = '0%'
  }
  const bind = () => {
    const b = document.getElementById('hold')
    if (!b) return
    b.addEventListener('pointerdown', start)
    for (const e of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(e, stop)
    b.addEventListener('keydown', start)
    b.addEventListener('keyup', stop)
    b.addEventListener('contextmenu', (e) => e.preventDefault())
  }
  draw()
  bind()
  actions(root, { back: () => go('/chests'), more: () => go('/chests') })
})
void toast

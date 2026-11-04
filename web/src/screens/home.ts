import { api } from '../api'
import { actions, avatar, esc, glyph, ic, lvBadge, GLYPH_BG, sfx, tap, toast } from '../lib'
import { BUILT } from '../games'
import { S, go, route } from '../state'
import { FLAME, JAR, coin, gameCard, netBadge, pipRow, tabs } from '../ui'
import { GAMES, fmtNim, type GameId } from '../../../shared/types'

export const GOALS = [10, 25, 50, 100, 250, 500, 1000, 5000]
export const jarGoal = (nimAmt: number) => GOALS.find((g) => nimAmt < g) ?? Math.ceil((nimAmt + 1) / 1000) * 1000

export function weekDots(days: string[]) {
  const set = new Set(days)
  const out: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)
    out.push(set.has(d) ? `<i class="d">${ic('check')}</i>` : i === 0 ? '<i class="n"></i>' : '<i></i>')
  }
  return out.join('')
}

export const lockText = (luna: number, unlockAt: number) =>
  luna <= 0 ? 'Win a Save duel to fill it' : unlockAt > Date.now() ? `Locked to ${new Date(unlockAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Unlocked, ready to withdraw'

route('/', async (root) => {
  try {
    S.me = await api.me()
  } catch {
    /* keep cached profile */
  }
  S.wallet.balance().then((b) => {
    S.balance = b
    const el = root.querySelector('.coin span')
    if (el) el.textContent = b == null ? '—' : fmtNim(b)
  })
  const me = S.me
  const jar = me.jarLuna / 1e5
  const goal = me.plan.goalLuna / 1e5
  const quest = Math.min(3, me.questWins)
  const msg = !me.vaultToday
    ? `<b>Today's vault is open.</b> Solve it to keep your ${me.streak}-day streak`
    : quest < 3
      ? `<b>${3 - quest} more duel win${3 - quest === 1 ? '' : 's'}</b> and today's chest opens`
      : `<b>Chest earned!</b> Come back tomorrow for a new quest`
  const preview = S.wallet.kind === 'preview' && !S.cfg.mock
  root.innerHTML = `
  <div class="top" style="min-height:64px"><button class="prof" data-act="me" style="text-align:left"><div class="pav">${avatar(me.avatar)}<span class="lvb" style="position:absolute;right:-8px;bottom:-6px">${lvBadge(me.level, 26)}</span></div><div class="xpi"><b>${esc(me.name)}</b><div class="xpb"><i style="width:${Math.round((me.levelXp / me.nextXp) * 100)}%"></i></div><span>${me.levelXp} / ${me.nextXp} XP</span></div></button>${coin()}</div>
  <div class="scroll">
    ${pipRow(quest >= 3 ? 'cheer' : 'happy', msg)}
    ${preview ? `<div class="card flat row" style="gap:10px"><span style="flex:1;font-size:13px;line-height:18px;font-weight:600">You are in preview. Free play works here. To stake NIM, open Nimbles inside Nimiq Pay. ${netBadge()}</span><button class="btn gold sm" data-act="openpay">Open</button></div>` : ''}
    <div class="quest"><img src="/badges/chest-open.svg" alt="" width="68" height="68"><div class="t"><span class="k">Daily quest</span><span class="n">Win 3 duels</span><div class="pbar"><i style="width:${(quest / 3) * 100}%"></i></div><span class="r">Opens a chest, +50 XP</span></div><span class="cnt">${quest}/3</span></div>
    <div class="duo">
      <button class="jarc" data-act="jar" style="text-align:left"><div class="h">${JAR}<div><div class="k">Savings jar</div><div class="n">${fmtNim(me.jarLuna)}<small> / ${fmtNim(me.plan.goalLuna)}</small></div></div></div><div class="bar"><i style="width:${Math.min(100, (jar / goal) * 100)}%"></i></div><div class="m">${ic('lock', 's16')}${lockText(me.jarLuna, me.jarUnlockAt)}</div></button>
      <div class="strk"><div class="h"><div class="flame">${FLAME}<b>${me.streak}</b></div><div><div class="k">Day streak</div><div class="sub">${me.vaultToday ? 'Vault done today' : 'Vault open today'}</div></div></div><div class="wk">${weekDots(me.streakDays)}</div><button class="btn gold sm block" data-act="vault" style="min-height:36px;font-size:14px">${me.vaultToday ? 'Vault deposit' : 'Play vault'}</button></div>
    </div>
    <div class="lab" style="margin-top:4px">Games<small>8 games, 1 to 3 min</small></div>
    <div class="gcs">${(Object.keys(GAMES) as GameId[]).map((id) => gameCard(id, GAMES[id])).join('')}</div>
  </div>${tabs('Play')}`
  actions(root, {
    game: (el) => (tap(), BUILT.has(el.dataset.id!) ? go('/g/' + el.dataset.id) : toast('Coming soon. Nimo is still setting this one up')),
    jar: () => (tap(), go('/jar')),
    vault: () => (tap(), go('/vault')),
    me: () => (tap(), go('/me')),
    openpay: () => {
      location.href = `nimiqpay://miniapp?url=${encodeURIComponent(location.href)}`
    },
    tab: () => sfx('ui/select', 0.4),
  })
})
export { glyph, GLYPH_BG }

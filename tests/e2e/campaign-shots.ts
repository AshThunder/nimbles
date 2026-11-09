// 390px screenshots of the Nimbles Showdown screens, on the mock chain with seeded data.
// Usage: npm run build && npx tsx tests/e2e/campaign-shots.ts [outDir]
import { chromium, devices, type Browser, type Page } from 'playwright'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.CHAIN = 'mock'
process.env.CAMPAIGN_TICK_MS = '3600000'
delete process.env.GEMINI_API_KEY
const ADDR = {
  chris: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0001',
  ada: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0002',
  tobi: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0003',
  kemi: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0004',
}
process.env.ADMIN_ADDRESSES = ADDR.chris
const OUT = process.argv[2] || join(import.meta.dirname, 'out', 'campaign')
mkdirSync(OUT, { recursive: true })
const { createApp } = await import('../../server/index')
const app = await createApp({ dataDir: mkdtempSync(join(tmpdir(), 'nimbles-shots-')), persist: false })
const PORT = 8798
await new Promise<void>((r) => app.server.listen(PORT, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${PORT}`

async function open(browser: Browser, who: keyof typeof ADDR, htlc = false): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, baseURL: BASE })
  await ctx.addInitScript(`(() => {
    const addr = ${JSON.stringify(ADDR[who])}
    const call = async (recipient, value, data) => (await (await fetch('/api/dev/mock-tx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: addr, to: recipient, luna: value, memo: data }) })).json()).hash
    window.nimiq = { listAccounts: async () => ${htlc ? "[addr, 'NQ07 0000 0000 0000 0000 0000 0000 0000 0099']" : '[addr]'}, getBalance: async () => 5000 * 1e5, sendBasicTransaction: async (t) => call(t.recipient, t.value, ''), sendBasicTransactionWithData: async (t) => call(t.recipient, t.value, t.data) }
    window.nimiqPay = { network: 'testnet', language: 'en' }
    localStorage.setItem('nb:muted', '1')
  })()`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error(`[${who}] pageerror`, e.message))
  await page.goto('/')
  await page.waitForSelector('.gcs')
  return page
}
const tok = (p: Page) => p.evaluate(() => sessionStorage.getItem('nb:token'))
const api = async (p: Page, method: string, path: string, body?: unknown) => p.evaluate(async ([m, u, b, t]) => (await fetch('/api' + u, { method: m as string, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined })).json(), [method, path, body, await tok(p)] as const)
const shot = async (p: Page, name: string, full = false) => {
  await p.waitForTimeout(400)
  await p.screenshot({ path: join(OUT, name + '.png'), fullPage: full })
  console.log('  saved', name)
}

const browser = await chromium.launch()
try {
  const chris = await open(browser, 'chris')
  const ada = await open(browser, 'ada')
  const tobi = await open(browser, 'tobi')
  const kemi = await open(browser, 'kemi')
  const db = app.engine.db
  const A = Object.fromEntries(Object.entries(ADDR).map(([k, v]) => [k, v])) as Record<string, string>
  // friends: Ada adds Chris's code; Chris asked Tobi; Kemi played Chris recently
  const code = (await api(chris, 'GET', '/friends')).code
  await api(ada, 'POST', '/friends/add', { code })
  db.profiles[A.chris].friends.push(A.tobi, A.kemi)
  db.profiles[A.tobi].friends.push(A.chris)
  await api(tobi, 'POST', '/friends/request', { address: A.chris })
  db.profiles[A.kemi].lastSeen = Date.now() - 3600_000
  // open Match me challenges from Ada and Tobi
  await api(ada, 'POST', '/matches', { game: 'darts', mode: 'win', stake: 5, opp: 'auto' })
  await api(tobi, 'POST', '/matches', { game: 'speedmath', mode: 'save', stake: 2, opp: 'auto' })
  await api(kemi, 'POST', '/matches', { game: 'darts', mode: 'win', stake: 2, opp: 'auto' })
  // a direct challenge from Ada to Chris
  await api(ada, 'POST', '/matches', { game: 'carrom', mode: 'win', stake: 1, opp: 'invite', challenge: A.chris })
  // campaign progress for Chris
  const c = app.campaign
  const s = (c as any).stat(A.chris)
  s.done = 7; s.human = 4; s.opps = [A.ada, A.tobi, A.kemi]; s.nimoDay = (await import('../../shared/campaign')).campaignDay(); s.nimoToday = 4; s.nimoLuna = 8e5
  s.weeks['0'] = { wins: 6, reachedAt: Date.now() - 1000 }
  ;(c as any).stat(A.ada).weeks['0'] = { wins: 9, reachedAt: Date.now() - 5000 }
  c.award('welcome', A.chris, 50, 'welcome:' + A.chris, 'Welcome reward')
  c.award('friend', A.chris, 20, 'friend:x1:' + A.chris, 'Friend duel')
  c.award('friend', A.chris, 20, 'friend:x2:' + A.chris, 'Friend duel')
  for (let i = 0; i < 4; i++) c.award('nimo', A.chris, 2, 'nimo:n' + i, 'Beat Nimo on Hard')
  c.award('friend', A.ada, 20, 'friend:x1:' + A.ada, 'Friend duel')
  c.award('welcome', A.ada, 50, 'welcome:' + A.ada, 'Welcome reward')
  c.award('invite', A.ada, 100, 'invite:' + A.kemi, 'Invite: Kemi joined and played')
  await c.tick()
  c.award('friend', A.chris, 20, 'friend:x3:' + A.chris, 'Friend duel')
  c.award('welcome', A.tobi, 50, 'welcome:' + A.tobi, 'Welcome reward')
  ;(c as any).payer.ownBalance = 0
  await c.tick()
  ;(c as any).payer.ownBalance = 49_700 * 1e5
  ;(c as any).cachedBalance = null
  // a few settled matches for the stats tab
  for (const [g, mode] of [['darts', 'win'], ['trivia', 'play'], ['speedmath', 'save'], ['darts', 'play'], ['carrom', 'win']] as const) {
    const id = 'seed' + g + mode
    db.matches[id] = { ...(Object.values(db.matches)[0] as any), id, code: 'NMB-' + id.slice(-4).toUpperCase(), game: g, mode, status: 'settled', opp: 'invite', challengeTo: undefined, createdAt: Date.now() - 3600_000, players: [{ player: { address: A.chris, name: 'Chris', avatar: 'me' }, funded: mode !== 'play', escrowed: mode === 'play' ? 0 : 2e5 }, { player: { address: A.ada, name: 'Ada', avatar: 'ada' }, funded: mode !== 'play', escrowed: mode === 'play' ? 0 : 2e5 }] }
  }
  db.profiles[A.chris].wins = 12; db.profiles[A.chris].played = 21
  db.profiles[A.ada].wins = 9; db.profiles[A.ada].played = 15

  // v3: invite code card that fits, per-step earnings, invited friends with their own progress
  db.profiles[A.kemi].invitedBy = A.chris
  ;(c as any).stat(A.kemi).done = 3
  db.profiles[A.tobi].invitedBy = A.chris
  ;(c as any).stat(A.tobi).done = 5; (c as any).stat(A.tobi).human = 2
  c.award('invite', A.chris, 100, 'invite:' + A.tobi, 'Invite: Tobi joined and played')
  ;(c as any).stat(A.chris).invites = 1
  const V3 = join(OUT, 'v3')
  mkdirSync(V3, { recursive: true })
  for (const [w, h, sfx] of [[390, 844, ''], [360, 780, '-360']] as const) {
    await chris.setViewportSize({ width: w, height: h })
    await chris.goto('/#/friends'); await chris.waitForSelector('.fcode')
    await chris.evaluate(() => document.querySelector('.fcode')?.scrollIntoView({ block: 'center' }))
    const fit = await chris.evaluate(`(() => { const card = document.querySelector('.fcode').closest('.card').getBoundingClientRect(); return [...document.querySelectorAll('.fcode .btn, .fcode .cd2')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= card.left && r.right <= card.right }) })()`)
    if (!fit) throw new Error(`invite code card overflows at ${w}px`)
    await chris.waitForTimeout(300)
    await chris.screenshot({ path: join(V3, `friends-tab${sfx}.png`) }); console.log('  saved v3/friends-tab' + sfx)
    if (!sfx) {
      // Share without a native share sheet copies the invite link
      await chris.evaluate(`Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })`)
      await chris.click('[data-act="share"]')
      await chris.waitForSelector('.toast:has-text("Link copied"), [role="status"]:has-text("Link copied")', { timeout: 3000 }).catch(async () => { throw new Error('Share fallback did not say Link copied: ' + (await chris.evaluate(() => document.body.innerText.slice(-200)))) })
      console.log('  share fallback: Link copied')
    }
    await chris.goto('/#/showdown'); await chris.waitForSelector('.chk')
    await chris.evaluate(() => document.querySelector('.chk')?.scrollIntoView({ block: 'start' }))
    await chris.waitForTimeout(300)
    await chris.screenshot({ path: join(V3, `showdown-steps${sfx}.png`) }); console.log('  saved v3/showdown-steps' + sfx)
    await chris.evaluate(() => document.querySelectorAll('.chk .it')[3]?.scrollIntoView({ block: 'start' }))
    await chris.waitForTimeout(300)
    await chris.screenshot({ path: join(V3, `showdown-steps${sfx}-2.png`) })
    const tags = await chris.locator('.chk .etag').count()
    if (tags !== 5) throw new Error('expected an earnings tag on all 5 steps, got ' + tags)
  }
  // open stakes: presets 10/50/100/500 plus Custom, checked against the balance (this stub wallet has a Pay HTLC holding 5000 NIM)
  const payer = await open(browser, 'chris', true)
  for (const [w, h, sfx] of [[390, 844, ''], [360, 780, '-360']] as const) {
    const chris = payer
    await chris.setViewportSize({ width: w, height: h })
    await chris.goto('/#/g/darts'); await chris.waitForSelector('#go')
    await chris.click('[data-act="mode"][data-m="win"]')
    await chris.click('[data-act="opp"][data-k="invite"]')
    const chips = await chris.locator('.stkrow .pc').allInnerTexts()
    if (chips.map((t) => t.replace(/\s+/g, '')).join(',') !== '10NIM,50NIM,100NIM,500NIM,Custom') throw new Error('stake chips: ' + chips.join(','))
    await chris.click('[data-act="stkc"]')
    await chris.fill('#stkin', '9000')
    if (!(await chris.isDisabled('#go'))) throw new Error('a stake above the balance must not start')
    if (!/more than your 5,?000/.test(await chris.locator('#stkerr').innerText())) throw new Error('missing balance error: ' + (await chris.locator('#stkerr').innerText()))
    await chris.evaluate(() => document.querySelector('.stkrow')?.scrollIntoView({ block: 'center' }))
    await chris.waitForTimeout(300)
    await chris.screenshot({ path: join(V3, `stake-custom-error${sfx}.png`) }); console.log('  saved v3/stake-custom-error' + sfx)
    await chris.fill('#stkin', '25')
    if (await chris.isDisabled('#go')) throw new Error('25 NIM should be allowed')
    if (!/25 NIM/.test(await chris.locator('#go').innerText())) throw new Error('button should show the custom stake')
    await chris.waitForTimeout(200)
    await chris.screenshot({ path: join(V3, `stake-custom${sfx}.png`) }); console.log('  saved v3/stake-custom' + sfx)
  }
  console.log('  stakes: presets 10/50/100/500 + Custom, balance check works')
  await chris.setViewportSize({ width: 390, height: 844 })

  // v2 layout: compact Showdown card, Quick match pill, five tabs, Showdown in Rank, tidy jar card
  const V2 = join(OUT, 'v2')
  mkdirSync(V2, { recursive: true })
  const shot2 = async (p: Page, name: string) => { await p.waitForTimeout(400); await p.screenshot({ path: join(V2, name + '.png') }); console.log('  saved v2/' + name) }
  const layoutFits = async (p: Page, w: number) => {
    // a string body: tsx would wrap named inner functions in a helper the page does not have
    const r = (await p.evaluate(`(() => {
      const one = (q) => { const e = document.querySelector(q); return e.getBoundingClientRect().height <= parseFloat(getComputedStyle(e).lineHeight) * 1.4 && e.scrollWidth <= e.clientWidth + 1 }
      const tabsBad = [...document.querySelectorAll('.tabs .tab')].filter((t) => t.scrollWidth > t.clientWidth + 1 || t.getBoundingClientRect().right > innerWidth + 0.5).length
      const qm = document.querySelector('.qm').getBoundingClientRect()
      const m = document.querySelector('.jarc .m span')
      return { tabs: document.querySelectorAll('.tabs .tab').length, tabsBad, qm: qm.right <= innerWidth - 8 && qm.height <= 36, jarN: one('.jarc .n'), jarK: one('.jarc .k'), jarM: m.getBoundingClientRect().height <= parseFloat(getComputedStyle(m).lineHeight) * 2 + 1, sd: one('.sdq .t .s') }
    })()`)) as Record<string, number | boolean>
    for (const [k, v] of Object.entries(r)) if (v === false || (k === 'tabs' && v !== 5) || (k === 'tabsBad' && v)) throw new Error(`layout at ${w}px: ${k} = ${v}`)
  }
  await chris.goto('/#/')
  await chris.waitForSelector('.sdq')
  const qh = await chris.evaluate(() => [document.querySelector('.sdq')!.getBoundingClientRect().height, document.querySelector('.quest')!.getBoundingClientRect().height])
  if (qh[0] > qh[1] + 0.5) throw new Error(`Showdown card ${qh[0]}px is taller than the quest card ${qh[1]}px`)
  await layoutFits(chris, 390)
  await shot2(chris, 'play-home')
  await chris.evaluate(() => document.querySelector('.glab')?.scrollIntoView({ block: 'start' }))
  await shot2(chris, 'play-home-scrolled')
  await chris.click('.qm')
  await chris.waitForSelector('.lobr')
  await shot2(chris, 'lobby')
  await chris.goto('/#/friends'); await chris.waitForSelector('.fcode')
  await shot2(chris, 'friends-tab')
  await chris.goto('/#/rank'); await chris.waitForSelector('.seg')
  await chris.click('[data-act="scope"][data-s="showdown"]')
  await chris.waitForSelector('.sdq')
  await shot2(chris, 'rank-showdown')
  await chris.setViewportSize({ width: 360, height: 780 })
  await chris.goto('/#/'); await chris.waitForSelector('.sdq')
  await layoutFits(chris, 360)
  await shot2(chris, 'play-home-360')
  await chris.evaluate(() => document.querySelector('.duo')?.scrollIntoView({ block: 'center' }))
  await shot2(chris, 'jar-360')
  await chris.goto('/#/rank'); await chris.waitForSelector('.seg')
  await chris.click('[data-act="scope"][data-s="showdown"]'); await chris.waitForSelector('.sdq')
  const segOk = await chris.evaluate(`[...document.querySelectorAll('.sg b')].every((b) => { const r = document.createRange(); r.selectNodeContents(b); return r.getBoundingClientRect().width <= b.parentElement.clientWidth - 6 })`)
  if (!segOk) throw new Error('Rank segments overflow at 360px: ' + JSON.stringify(await chris.evaluate(`[...document.querySelectorAll('.sg b')].map((b) => { const r = document.createRange(); r.selectNodeContents(b); return [Math.round(r.getBoundingClientRect().width), b.parentElement.clientWidth] })`)))
  await shot2(chris, 'rank-showdown-360')
  await chris.setViewportSize({ width: 390, height: 844 })
  console.log(`  v2: card ${qh[0]}px vs quest ${qh[1]}px; 5 tabs, Quick match, jar card and Rank segments fit at 360 and 390`)

  await chris.goto('/#/')
  await chris.waitForSelector('.sdq')
  await shot(chris, 'campaign-card')
  await chris.goto('/#/showdown'); await chris.waitForSelector('.chk')
  await shot(chris, 'campaign-detail')
  await chris.evaluate(() => document.querySelector('.qrow')?.scrollIntoView({ block: 'start' }))
  await shot(chris, 'campaign-detail-2')
  await chris.goto('/#/lobby'); await chris.waitForSelector('.lobr')
  await shot(chris, 'lobby')
  // Match me inside a game: open challenges and the nearest-stake confirm
  await chris.goto('/#/g/darts')
  await chris.click('[data-act="mode"][data-m="win"]')
  await chris.click('[data-act="opp"][data-k="auto"]')
  await chris.waitForSelector('.lob .lobr')
  await shot(chris, 'lobby-in-game')
  // the page jump: a tap that redraws the screen must keep the scroll position
  await chris.setViewportSize({ width: 390, height: 600 })
  const before = await chris.evaluate(() => { const e = document.querySelector('.scroll')!; e.scrollTop = e.scrollHeight; return e.scrollTop })
  const chipY = await chris.evaluate(() => document.querySelector('[data-act="stake"][data-s="10"]')!.getBoundingClientRect().top)
  await chris.click('[data-act="stake"][data-s="10"]')
  const after = await chris.evaluate(() => document.querySelector('.scroll')!.scrollTop)
  const chipY2 = await chris.evaluate(() => document.querySelector('[data-act="stake"][data-s="10"]')!.getBoundingClientRect().top)
  if (before < 50 || Math.abs(after - before) > 1 || Math.abs(chipY2 - chipY) > 1) throw new Error(`page jumped: scroll ${before} -> ${after}, chip ${chipY} -> ${chipY2}`)
  await chris.setViewportSize({ width: 390, height: 844 })
  console.log(`  no jump: scroll stayed at ${after}px, the tapped chip stayed at ${Math.round(chipY2)}px`)
  await chris.click('#go')
  await chris.waitForSelector('.sheet')
  await shot(chris, 'lobby-nearest-stake')
  await chris.goto('/#/friends'); await chris.waitForSelector('.fcode')
  await shot(chris, 'friends')
  // trivia topic: typing, then locked in
  await chris.goto('/#/g/trivia')
  await chris.click('[data-act="tedit"]')
  await chris.fill('#topic', 'Afrobeats legends')
  await shot(chris, 'trivia-topic-typing')
  await chris.press('#topic', 'Enter')
  await chris.waitForSelector('.tpk')
  await shot(chris, 'trivia-topic-locked')
  await chris.goto('/#/admin'); await chris.waitForSelector('.kpis')
  await shot(chris, 'admin-campaign')
  for (const [i, sel] of [[2, '.poolr'], [3, '.amt'], [4, 'table']] as const) {
    await chris.evaluate((q) => document.querySelectorAll(q)[q === 'table' ? 1 : 0]?.scrollIntoView({ block: 'start' }), sel)
    await shot(chris, 'admin-campaign-' + i)
  }
  await chris.click('[data-act="tab"][data-k="stats"]')
  await chris.waitForSelector('.spark')
  await shot(chris, 'admin-stats')
  await chris.evaluate(() => document.querySelector('table')?.scrollIntoView({ block: 'start' }))
  await shot(chris, 'admin-stats-2')
  // a non-admin sees the refusal
  await ada.goto('/#/admin'); await ada.waitForSelector('.err')
  await shot(ada, 'admin-refused')
} finally {
  await browser.close()
  app.close()
}

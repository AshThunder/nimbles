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

async function open(browser: Browser, who: keyof typeof ADDR): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, baseURL: BASE })
  await ctx.addInitScript(`(() => {
    const addr = ${JSON.stringify(ADDR[who])}
    const call = async (recipient, value, data) => (await (await fetch('/api/dev/mock-tx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: addr, to: recipient, luna: value, memo: data }) })).json()).hash
    window.nimiq = { listAccounts: async () => [addr], getBalance: async () => 5000 * 1e5, sendBasicTransaction: async (t) => call(t.recipient, t.value, ''), sendBasicTransactionWithData: async (t) => call(t.recipient, t.value, t.data) }
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

  await chris.goto('/#/')
  await chris.waitForSelector('.sdc')
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

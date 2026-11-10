// Beat Nimo on Hard card, results message and admin section, on the mock chain with seeded data.
// Usage: npm run build && npx tsx tests/e2e/campaign-shots.ts [outDir]
import { chromium, devices, type Browser, type Page } from 'playwright'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.CHAIN = 'mock'
process.env.CAMPAIGN_TICK_MS = '3600000'
process.env.BEAT_NIMO_START = new Date(Date.now() - 3600_000).toISOString()
delete process.env.GEMINI_API_KEY
const ADDR = {
  chris: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0001',
  ada: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0002',
  tobi: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0003',
  kemi: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0004',
}
process.env.ADMIN_ADDRESSES = ADDR.chris
const OUT = process.argv[2] || join(import.meta.dirname, 'out', 'beatnimo')
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
    localStorage.setItem('nb:muted', '1'); localStorage.setItem('nb:pay-approved', '1')
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
  const db = app.engine.db
  await chris.goto('/'); await chris.waitForSelector('.bnq'); await shot(chris, 'home-open')
  // a real trivia win against Nimo on Hard for Chris
  const c = await api(chris, 'POST', '/matches', { game: 'trivia', mode: 'play', opp: 'pip', pipLevel: 'hard', config: { topic: 'Science', count: 5 } })
  const m = db.matches[c.id]
  m.startsAt = Date.now() - 30_000
  await api(chris, 'GET', `/matches/${c.id}`)
  m.trivia!.pip = m.trivia!.pip!.map((x: any) => ({ ...x, correct: false, points: 0 }))
  for (let i = 0; i < 5; i++) await api(chris, 'POST', `/matches/${c.id}/answer`, { q: i, choice: m.trivia!.questions[i].answer, ms: 1500 })
  await chris.goto('/#/m/' + c.id).catch(() => {})
  await chris.evaluate((id) => { location.hash = '#/m/' + id }, c.id)
  await chris.waitForSelector('.bnr', { timeout: 15000 }).catch(() => console.log('no .bnr'))
  await shot(chris, 'result')
  await chris.goto('/'); await chris.waitForSelector('.bnq'); await shot(chris, 'home-claimed')
  // fill the remaining slots, then Ada sees the sold-out state
  const camp = app.campaign as any
  for (let i = 0; i < 60; i++) { const a = 'NQ07 0000 0000 0000 0000 0000 0000 0001 ' + String(1000 + i); db.profiles[a] = { ...db.profiles[ADDR.ada], address: a }; camp.claimBeatNimo({ id: 'z' + i, game: 'darts', players: [{ player: { address: a } }] }) }
  await ada.goto('/'); await ada.waitForSelector('.bnq'); await shot(ada, 'home-soldout')
  await chris.goto('/'); await chris.evaluate(() => { location.hash = '#/admin' })
  await chris.waitForTimeout(1500); await shot(chris, 'admin', true)
} finally { await browser.close(); app.close() }

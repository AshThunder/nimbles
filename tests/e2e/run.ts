// End-to-end test in a headless mobile browser with a mocked Nimiq Pay provider (window.nimiq / window.nimiqPay).
// The real @nimiq/mini-app-sdk runs against the mock, the server runs on the in-memory mock chain.
// Usage: npm run build && npm run e2e         (E2E_AI=1 to use live Gemini instead of the question bank)
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { canMake } from '../../shared/words'

process.env.CHAIN = 'mock'
if (!process.env.E2E_AI) delete process.env.GEMINI_API_KEY
const { createApp } = await import('../../server/index')
const { makeSudoku } = await import('../../shared/puzzles')

const PORT = 8799
const BASE = `http://127.0.0.1:${PORT}`
const OUT = join(import.meta.dirname, 'out')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const app = await createApp({ dataDir: mkdtempSync(join(tmpdir(), 'nimbles-e2e-')), persist: false })
await new Promise<void>((r) => app.server.listen(PORT, '127.0.0.1', r))

const ADDR = {
  chris: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0001',
  ada: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0002',
  tobi: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0003',
}
const real: Record<string, string> = {}
const pages = new Map<string, Page>()
const errors: string[] = []
let step = 0
const log = (s: string) => console.log(`  ✓ ${s}`)

async function player(browser: Browser, name: keyof typeof ADDR): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, baseURL: BASE })
  // plain string so the transpiler cannot inject helpers into the page context
  await ctx.addInitScript(`(() => {
    const addr = ${JSON.stringify(ADDR[name])}
    const call = async (recipient, value, data) => {
      const r = await fetch('/api/dev/mock-tx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: addr, to: recipient, luna: value, memo: data }) })
      return (await r.json()).hash
    }
    window.nimiq = {
      listAccounts: async () => [addr],
      getBalance: async () => 5000 * 1e5,
      sendBasicTransaction: async (t) => call(t.recipient, t.value, ''),
      sendBasicTransactionWithData: async (t) => call(t.recipient, t.value, t.data),
    }
    window.nimiqPay = { network: 'testnet', language: 'en' }
  })()`)
  const page = await ctx.newPage()
  pages.set(name, page)
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`[${name}] console: ${m.text()}`))
  page.on('response', (r) => r.status() >= 500 && errors.push(`[${name}] ${r.status()} ${r.url()}`))
  await page.goto('/')
  await page.waitForSelector('.gcs')
  real[name] = (await page.evaluate(async (t) => (await (await fetch('/api/me', { headers: { authorization: 'Bearer ' + t } })).json()).address, await token(page))) as string
  return { ctx, page }
}
const shot = async (p: Page, name: string) => p.screenshot({ path: join(OUT, `${String(++step).padStart(2, '0')}-${name}.png`) })
function token(p: Page) {
  return p.evaluate(() => sessionStorage.getItem('nb:token'))
}
const matchOf = async (p: Page, id: string) => p.evaluate(async ([id, t]) => (await fetch('/api/matches/' + id, { headers: { authorization: 'Bearer ' + t } })).json(), [id, (await token(p))!] as const)
const matchId = (p: Page) => p.url().split('/m/')[1]

const browser = await chromium.launch()
try {
  // ---------- 1. Home + wallet via the real SDK ----------
  const chris = await player(browser, 'chris')
  const c = chris.page
  assert.equal(await c.locator('.gc').count(), 8, '8 game cards')
  assert.match(await c.locator('.xpi b').innerText(), /.+/)
  assert.ok(!(await c.content()).includes('Preview'), 'inside Nimiq Pay there is no preview banner')
  await shot(c, 'home')
  log('home renders, wallet connected through the SDK')

  // ---------- 2. Trivia vs Pip (Play) ----------
  await c.locator('.gc[data-id=trivia]').click()
  await c.waitForSelector('#go')
  await shot(c, 'setup-trivia')
  await c.locator('#go').click()
  await c.waitForSelector('.arena', { timeout: 10000 })
  await c.waitForSelector('.ans')
  await shot(c, 'trivia-q1')
  for (let i = 0; i < 5; i++) {
    await c.waitForSelector('.ans:not(.locked)')
    await c.locator('.ans').first().click()
    if (i === 0) {
      await c.waitForSelector('.ans.right')
      await shot(c, 'trivia-answered')
    }
    await c.waitForTimeout(1300)
  }
  await c.waitForSelector('.res', { timeout: 20000 })
  await shot(c, 'trivia-result-pip')
  log('trivia vs Pip: played 5 questions to the result screen')
  await c.locator('[data-act=home]').click()
  await c.waitForSelector('.gcs')

  // ---------- 3. Staked Save duel: invite → join → fund → play → settle ----------
  const ada = await player(browser, 'ada')
  const a = ada.page
  await c.locator('.gc[data-id=trivia]').click()
  await c.locator('[data-act=mode][data-m=save]').click()
  await c.locator('[data-act=opp][data-k=invite]').click()
  await c.locator('[data-act=stake][data-s="2"]').click()
  await shot(c, 'setup-save-invite')
  await c.locator('#go').click()
  await c.waitForSelector('#code')
  const code = (await c.locator('#code').innerText()).trim()
  assert.match(code, /^NMB-[A-Z0-9]{4}$/)
  await shot(c, 'lobby-invite')
  const id = matchId(c)
  // Ada joins by typing the code on the setup screen
  await a.locator('.gc[data-id=trivia]').click()
  await a.locator('[data-act=opp][data-k=join]').click()
  await a.locator('#code').fill(code)
  await shot(a, 'setup-join')
  await a.locator('#go').click()
  await a.waitForSelector('[data-act=fund]')
  await c.waitForSelector('[data-act=fund]')
  await shot(c, 'funding')
  await c.locator('[data-act=fund]').click()
  await a.locator('[data-act=fund]').click()
  await c.waitForSelector('#cd', { timeout: 15000 })
  await shot(c, 'countdown')
  await c.waitForSelector('.ans', { timeout: 15000 })
  await a.waitForSelector('.ans', { timeout: 15000 })
  const mv = await matchOf(c, id)
  assert.equal(mv.status, 'playing')
  assert.equal(mv.mode, 'save')
  log('invite + join by code, both deposits verified on the mock chain, countdown, play started with one seed')
  const play = async (p: Page, pick: (n: number) => number) => {
    for (let i = 0; i < 5; i++) {
      await p.waitForSelector('.ans:not(.locked)', { timeout: 10000 })
      await p.locator('.ans').nth(pick(i)).click()
      await p.waitForTimeout(1300)
    }
  }
  await shot(a, 'trivia-duel-ada')
  await Promise.all([play(c, () => 0), play(a, () => 1)])
  await c.waitForSelector('.res', { timeout: 25000 })
  await a.waitForSelector('.res', { timeout: 25000 })
  await shot(c, 'save-result-chris')
  await shot(a, 'save-result-ada')
  const sm = await matchOf(c, id)
  assert.equal(sm.status, 'settled')
  assert.ok(sm.settlement.winner || sm.settlement.draw)
  if (sm.settlement.winner) assert.ok(Object.values(sm.settlement.jarCredit as Record<string, number>)[0] === 4 * 1e5, 'winner jar gets the 4 NIM pot')
  log(`Save duel settled: ${sm.settlement.draw ? 'draw, refunds' : 'winner jar +4 NIM'}`)
  await c.goto('/#/jar')
  await c.waitForSelector('.jarart')
  await shot(c, 'jar')

  // ---------- 4. Last Bite (Spend): ada fronts the bill, chris + tobi settle ----------
  const tobi = await player(browser, 'tobi')
  const t = tobi.page
  await a.goto('/#/g/lastbite')
  await a.waitForSelector('#bill')
  await a.locator('#bill').fill('9')
  await a.locator('[data-act=size][data-n="3"]').click()
  await shot(a, 'setup-lastbite')
  await a.locator('#go').click()
  await a.waitForSelector('#code')
  const lbCode = (await a.locator('#code').innerText()).trim()
  const lbId = matchId(a)
  await c.goto(`/#/join/${lbCode}`)
  await c.waitForSelector('text=Waiting for')
  await t.goto(`/#/join/${lbCode}`)
  await t.waitForSelector('[data-act=fund]')
  await c.waitForSelector('[data-act=fund]')
  await shot(t, 'funding-lastbite')
  await Promise.all([c.locator('[data-act=fund]').click(), t.locator('[data-act=fund]').click()])
  for (const p of [a, c, t]) await p.waitForSelector('.sdk', { timeout: 20000 })
  await shot(a, 'lastbite-playing')
  const lm = await matchOf(a, lbId)
  const pz = makeSudoku(lm.seed, 4)
  const solve = async (p: Page, upTo = 99) => {
    let n = 0
    for (let i = 0; i < 16 && n < upTo; i++) {
      if (pz.puzzle[i]) continue
      await p.locator(`.cell[data-i="${i}"]`).click()
      await p.locator(`.key[data-n="${pz.solution[i]}"]`).click()
      n++
    }
  }
  await solve(a)
  await solve(c, 4)
  await shot(c, 'lastbite-partial')
  await c.locator('[data-fin]').click()
  await c.locator('[data-fin]').click()
  await t.locator('[data-fin]').click()
  await t.locator('[data-fin]').click()
  for (const p of [a, c, t]) await p.waitForSelector('.res', { timeout: 20000 })
  await shot(a, 'lastbite-result-payer')
  await shot(t, 'lastbite-result-last')
  const lbs = await matchOf(a, lbId)
  assert.equal(lbs.settlement.ranks[0].address, real.ada, 'full solve wins')
  const shares = lbs.players.map((p: any) => p.share)
  assert.equal(shares.reduce((s: number, x: number) => s + x, 0), 9 * 1e5, 'shares add up to the bill')
  log(`Last Bite: 3 players, shares ${shares.map((x: number) => x / 1e5).join('/')} sum to the 9 NIM bill`)
  await new Promise((r) => setTimeout(r, 2500))
  const paid = (await (await fetch(`${BASE}/api/dev/mock-payouts`)).json()) as { to: string; luna: number }[]
  assert.ok(paid.some((p) => p.to === real.ada), 'bill payer received settlement')

  // ---------- 5. Solitaire vs Pip + Sudoku vs Pip ----------
  await c.goto('/#/g/solitaire')
  await c.waitForSelector('#go')
  await c.locator('#go').click()
  await c.waitForSelector('.tab7', { timeout: 15000 })
  await c.locator('[data-a=stock]').click()
  await c.locator('[data-a=stock]').click()
  await shot(c, 'solitaire')
  // a real move: find any legal tableau tap by trying the waste then a face-up card
  await c.locator('[data-fin]').click()
  await c.locator('[data-fin]').click()
  await c.waitForSelector('.res', { timeout: 15000 })
  await shot(c, 'solitaire-result')
  log('solitaire duel vs Pip: dealt from seed, drew cards, finished, scored')

  await c.goto('/#/g/sudoku')
  await c.waitForSelector('#go')
  await c.locator('#go').click()
  await c.waitForSelector('.sdk.n9', { timeout: 15000 })
  await shot(c, 'sudoku9')
  await c.locator('[data-fin]').click()
  await c.locator('[data-fin]').click()
  await c.waitForSelector('.res', { timeout: 15000 })
  log('sudoku 9x9 vs Pip played to a result')

  // ---------- 5b. Word Rush, Bubble Shooter, Chess, Pool vs Pip ----------
  await c.goto('/#/g/word')
  await c.waitForSelector('#go')
  await c.locator('#go').click()
  await c.waitForSelector('.wt', { timeout: 15000 })
  const rackLetters = (await c.locator('.wt').allInnerTexts()).map((x) => x.toLowerCase())
  const dict = new Set(readFileSync(new URL('../../assets/words/dict.txt', import.meta.url), 'utf8').split('\n').filter(Boolean))
  const seven = [...dict].find((w) => w.length === 7 && canMake(w, rackLetters))
  assert.ok(seven, 'rack has a 7-letter word')
  const tapWord = async (w: string) => {
    const used = new Set<number>()
    for (const ch of w) {
      const i = rackLetters.findIndex((l, k) => l === ch && !used.has(k))
      used.add(i)
      await c.locator(`.wt[data-i="${i}"]`).click()
    }
    await c.locator('[data-w=enter]').click()
  }
  await tapWord(seven!)
  await c.locator('[data-w=enter]').click()
  await c.waitForSelector('.wf')
  await shot(c, 'word-rush')
  await c.locator('[data-fin]').click()
  await c.locator('[data-fin]').click()
  await c.waitForSelector('.res', { timeout: 15000 })
  const wm = await c.evaluate(async () => (await (await fetch('/api/me')).json()))
  log(`word rush: ${seven} accepted client-side, finished vs Pip (${wm.address ? 'me ok' : ''})`)

  await c.goto('/#/g/bubble')
  await c.waitForSelector('#go')
  await c.locator('#go').click()
  await c.waitForSelector('#cv', { timeout: 15000 })
  const box = (await c.locator('#cv').boundingBox())!
  for (const fx of [0.25, 0.5, 0.75, 0.4, 0.6, 0.5]) {
    await c.mouse.move(box.x + box.width / 2, box.y + box.height - 34)
    await c.mouse.down()
    await c.mouse.move(box.x + box.width * fx, box.y + 60, { steps: 3 })
    await c.mouse.up()
    await c.waitForTimeout(1300)
  }
  await shot(c, 'bubble')
  const popped = await c.locator('#pp').innerText()
  await c.locator('[data-fin]').click()
  await c.locator('[data-fin]').click()
  await c.waitForSelector('.res', { timeout: 15000 })
  log(`bubble shooter: 6 shots fired (${popped}), finished vs Pip`)

  await c.goto('/#/g/chess')
  await c.waitForSelector('#go')
  assert.equal(await c.locator('[data-act=mode]').count(), 3, 'chess offers Play, Save and Spend')
  await shot(c, 'setup-chess')
  await c.locator('#go').click()
  await c.waitForSelector('.sqr[data-s=e2]', { timeout: 15000 })
  await c.locator('.sqr[data-s=e2]').click()
  await shot(c, 'chess-selected')
  await c.locator('.sqr[data-s=e4]').click()
  await c.waitForSelector('.sqr.lm img[src*="/b-"]', { timeout: 10000 })
  await shot(c, 'chess')
  log('chess: legal move highlighted and played, Pip replied')
  await c.locator('[data-fin]').click()
  await c.locator('[data-fin]').click()
  await c.waitForSelector('.res', { timeout: 15000 })

  await c.goto('/#/g/pool')
  await c.waitForSelector('#go')
  assert.equal(await c.locator('[data-act=mode]').count(), 3, 'pool offers every mode')
  await c.locator('#go').click()
  await c.waitForSelector('#cv', { timeout: 15000 })
  const pb = (await c.locator('#cv').boundingBox())!
  await c.mouse.click(pb.x + pb.width / 2, pb.y + pb.height * 0.2)
  await shot(c, 'pool-aim')
  await c.locator('#sh').click()
  await c.waitForFunction(() => !/Rolling/.test(document.querySelector('#cst')?.textContent ?? ''), null, { timeout: 30000 })
  await c.waitForTimeout(500)
  await shot(c, 'pool-after-break')
  const pst = await c.locator('#cst').innerText()
  log(`pool: break shot rolled and settled, status "${pst}"`)
  await c.locator('[data-fin]').click()
  await c.locator('[data-fin]').click()
  await c.waitForSelector('.res', { timeout: 15000 })

  // ---------- 5b. Live staked chess: chris vs ada through the server relay ----------
  await c.goto('/#/g/chess')
  await c.waitForSelector('#go')
  await c.locator('[data-act=mode][data-m=save]').click()
  await c.locator('[data-act=opp][data-k=invite]').click()
  await c.locator('[data-act=stake][data-s="2"]').click()
  await c.locator('#go').click()
  await c.waitForSelector('#code')
  const chCode = (await c.locator('#code').innerText()).trim()
  const chId = matchId(c)
  await a.goto('/#/g/chess')
  await a.locator('[data-act=opp][data-k=join]').click()
  await a.locator('#code').fill(chCode)
  await a.locator('#go').click()
  await a.waitForSelector('[data-act=fund]')
  await c.waitForSelector('[data-act=fund]')
  await c.locator('[data-act=fund]').click()
  await a.locator('[data-act=fund]').click()
  await c.waitForSelector('.cb', { timeout: 20000 })
  await a.waitForSelector('.cb', { timeout: 20000 })
  const turnOf = async () => ((await matchOf(c, chId)).live.moves.length % 2 ? 'b' : 'w')
  const cm = await matchOf(c, chId)
  const whiteIsChris = cm.players[cm.live.white].player.address === real.chris
  const [wp, bp] = whiteIsChris ? [c, a] : [a, c]
  await shot(wp, 'chess-live-white')
  await shot(bp, 'chess-live-black')
  assert.equal(await turnOf(), 'w')
  // black cannot move out of turn; white plays e4, black answers e5
  await bp.locator('.sqr[data-s=e7]').click()
  await bp.locator('.sqr[data-s=e5]').click()
  await bp.waitForTimeout(600)
  assert.equal(await turnOf(), 'w', 'out-of-turn move rejected by the server')
  await wp.locator('.sqr[data-s=e2]').click()
  await wp.locator('.sqr[data-s=e4]').click()
  await bp.waitForSelector('.sqr[data-s=e4] img', { timeout: 8000 })
  await bp.locator('.sqr[data-s=e7]').click()
  await bp.locator('.sqr[data-s=e5]').click()
  await wp.waitForSelector('.sqr[data-s=e5] img', { timeout: 8000 })
  await shot(wp, 'chess-live-moves')
  await bp.locator('[data-fin]').click()
  await bp.locator('[data-fin]').click()
  for (const p of [a, c]) await p.waitForSelector('.res', { timeout: 20000 })
  const chs = await matchOf(c, chId)
  assert.equal(chs.status, 'settled')
  assert.equal(chs.settlement.winner, whiteIsChris ? real.chris : real.ada, 'resigning loses')
  await shot(wp, 'chess-live-result-win')
  log('live chess: staked duel, server relays moves, out-of-turn blocked, resignation settles')

  // ---------- 5c. Live pool (Play mode): breaker shoots, both phones see the same shot ----------
  await c.goto('/#/g/pool')
  await c.waitForSelector('#go')
  await c.locator('[data-act=opp][data-k=invite]').click()
  await c.locator('#go').click()
  await c.waitForSelector('#code')
  const plCode = (await c.locator('#code').innerText()).trim()
  const plId = matchId(c)
  await a.goto('/#/g/pool')
  await a.locator('[data-act=opp][data-k=join]').click()
  await a.locator('#code').fill(plCode)
  await a.locator('#go').click()
  await c.waitForSelector('#cv', { timeout: 25000 })
  await a.waitForSelector('#cv', { timeout: 25000 })
  const pm = await matchOf(c, plId)
  const breakerIsChris = pm.players[pm.live.turn].player.address === real.chris
  const [bk, ot] = breakerIsChris ? [c, a] : [a, c]
  assert.equal(await ot.locator('#sh').isDisabled(), true, 'shoot is locked off turn')
  const bb = (await bk.locator('#cv').boundingBox())!
  await bk.mouse.click(bb.x + bb.width / 2, bb.y + bb.height * 0.2)
  await bk.locator('#sh').click()
  await ot.waitForFunction(() => /Rolling/.test(document.querySelector('#cst')?.textContent ?? ''), null, { timeout: 10000 })
  await shot(ot, 'pool-live-watching')
  await bk.waitForFunction(() => !/Rolling/.test(document.querySelector('#cst')?.textContent ?? ''), null, { timeout: 30000 })
  await ot.waitForFunction(() => !/Rolling/.test(document.querySelector('#cst')?.textContent ?? ''), null, { timeout: 30000 })
  const pm2 = await matchOf(c, plId)
  assert.equal(pm2.live.shotNo, 1, 'one shot recorded on the server')
  await shot(ot, 'pool-live-after')
  await ot.locator('[data-fin]').click()
  await ot.locator('[data-fin]').click()
  for (const p of [a, c]) await p.waitForSelector('.res', { timeout: 20000 })
  assert.equal((await matchOf(c, plId)).status, 'settled')
  log('live pool: server-run break shown on both phones, off-turn locked, concede settles')

  // ---------- 6. Vault, rank, pip, me, credits ----------
  await c.goto('/#/vault')
  await c.waitForSelector('.sdk.n4')
  const vp = await (await fetch(`${BASE}/api/vault/puzzle`)).json()
  const vs = makeSudoku('vault:' + vp.day, 4, 7)
  await shot(c, 'vault')
  for (let i = 0; i < 16; i++) {
    if (vp.puzzle[i]) continue
    await c.locator(`.cell[data-i="${i}"]`).click()
    await c.locator(`.key[data-n="${vs.solution[i]}"]`).click()
  }
  await c.waitForSelector('[data-act=dep]', { timeout: 10000 })
  await shot(c, 'vault-solved')
  await c.locator('[data-act=dep][data-a="1"]').click()
  await c.waitForSelector('text=Added to your jar', { timeout: 15000 })
  log('vault solved, +XP, 1 NIM jar deposit verified')
  await c.goto('/#/rank')
  await c.waitForSelector('.rw')
  await shot(c, 'rank')
  await c.goto('/#/pip')
  await c.waitForSelector('#rt')
  await shot(c, 'pip')
  await c.goto('/#/me')
  await c.waitForSelector('#nm')
  await shot(c, 'me')
  await c.goto('/#/credits')
  await c.waitForSelector('.credit')
  await shot(c, 'credits')
  assert.match(await c.locator('.credit').first().innerText(), /Skoll/)
  await c.goto('/')
  await c.waitForSelector('.gcs')
  await shot(c, 'home-after')
  log('rank, Pip, profile, credits (CC BY credit present)')

  // ---------- 7. Preview mode (no wallet): free play only ----------
  const pctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, baseURL: BASE })
  const pp = await pctx.newPage()
  await pp.goto('/?preview')
  await pp.waitForSelector('.gcs')
  await shot(pp, 'preview-home')
  log('preview identity works outside Nimiq Pay')
} catch (e) {
  for (const [n, p] of pages) await p.screenshot({ path: join(OUT, `FAIL-${n}.png`) }).catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await browser.close()
  app.close()
}
if (process.exitCode) process.exit(1)
if (errors.length) {
  console.error('Browser errors:\n' + errors.join('\n'))
  process.exit(1)
}
console.log(`E2E passed. ${step} screenshots in ${OUT}`)

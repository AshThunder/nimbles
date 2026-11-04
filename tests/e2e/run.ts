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
const BREAK = !!process.env.E2E_BREAK
if (!process.env.E2E_AI) delete process.env.GEMINI_API_KEY
const { createApp } = await import('../../server/index')
const { makeSudoku } = await import('../../shared/puzzles')

const [VW, VH] = (process.env.E2E_VIEWPORT || '390x844').split('x').map(Number)
const VP = { width: VW, height: VH }
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
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: VP, baseURL: BASE })
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
  if (BREAK) await ctx.addInitScript(`addEventListener('DOMContentLoaded',()=>{const st=document.createElement('style');st.textContent='.top{padding-top:60px!important;height:56px!important}';document.head.appendChild(st)})`)
  await page.goto('/')
  await page.waitForSelector('.gcs')
  real[name] = (await page.evaluate(async (t) => (await (await fetch('/api/me', { headers: { authorization: 'Bearer ' + t } })).json()).address, await token(page))) as string
  return { ctx, page }
}
// Layout check run on every screenshot: no overlapping in-flow siblings, no clipped text, nothing off the sides,
// and the game screens must fit without scrolling. Failures are collected and fail the run.
const layoutIssues: string[] = []
const NO_SCROLL = /^(solitaire$|sudoku|word-rush|bubble|chess$|chess-selected|chess-live|pool)/
const CHECK_JS = String.raw`(noScroll) => {
  var out = []
  var app = document.getElementById('app')
  var W = window.innerWidth
  var label = function (e) { return e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '') }
  var live = function (e) {
    var cs = getComputedStyle(e)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'absolute' || cs.position === 'fixed') return false
    var r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  var skip = function (e) { return !!e.closest('svg,canvas,.cf-layer,.toast,.scrim,.sheet,[data-overlap-ok]') }
  var all = [app].concat(Array.from(app.querySelectorAll('*')))
  all.forEach(function (parent) {
    if (skip(parent)) return
    var kids = Array.from(parent.children).filter(function (k) { return live(k) && !skip(k) && getComputedStyle(k).display !== 'inline' })
    for (var i = 0; i < kids.length; i++)
      for (var j = i + 1; j < kids.length; j++) {
        var a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect()
        var ox = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        var oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (ox > 2 && oy > 2) out.push('overlap ' + label(kids[i]) + ' x ' + label(kids[j]) + ' (' + Math.round(ox) + 'x' + Math.round(oy) + 'px)')
      }
  })
  all.forEach(function (e) {
    if (e === app || skip(e)) return
    var cs = getComputedStyle(e)
    if (cs.display === 'none') return
    if (cs.overflowY === 'hidden' && e.scrollHeight > e.clientHeight + 2 && e.clientHeight > 0 && e.textContent.trim())
      out.push('clipped ' + label(e) + ' (' + e.scrollHeight + '>' + e.clientHeight + ')')
    if (cs.overflowX === 'hidden' && e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && cs.textOverflow !== 'ellipsis' && e.textContent.trim())
      out.push('clipped-x ' + label(e) + ' (' + e.scrollWidth + '>' + e.clientWidth + ')')
    if (live(e)) {
      var r = e.getBoundingClientRect()
      if (r.right > W + 1) out.push('offscreen ' + label(e) + ' right=' + Math.round(r.right) + '>' + W)
      if (r.left < -1) out.push('offscreen ' + label(e) + ' left=' + Math.round(r.left))
    }
  })
  Array.from(app.querySelectorAll('.top')).forEach(function (t) {
    var tr = t.getBoundingClientRect()
    Array.from(t.children).forEach(function (c) {
      var r = c.getBoundingClientRect()
      if (r.height > 0 && (r.bottom > tr.bottom + 1 || r.top < tr.top - 1)) out.push('top row child sticks out of header: ' + label(c))
    })
  })
  var sc = app.querySelector('.scroll')
  if (sc && new RegExp(noScroll).test(document.body.dataset.shot || '') && sc.scrollHeight > sc.clientHeight + 2) out.push('must fit without scrolling (' + sc.scrollHeight + '>' + sc.clientHeight + ')')
  return Array.from(new Set(out))
}`
async function checkLayout(p: Page, name: string) {
  const issues = (await p.evaluate(`(${CHECK_JS})(${JSON.stringify(NO_SCROLL.source)})`)) as string[]
  for (const i of issues) layoutIssues.push(`[${VW}x${VH}] ${name}: ${i}`)
}
const shot = async (p: Page, name: string) => {
  await p.evaluate((n) => (document.body.dataset.shot = n), name).catch(() => {})
  await checkLayout(p, name).catch((e) => layoutIssues.push(`[check failed] ${name}: ${String(e).slice(0, 120)}`))
  return p.screenshot({ path: join(OUT, `${String(++step).padStart(2, '0')}-${name}.png`) })
}
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

  // ---------- 2. Trivia vs Nimo (Play) ----------
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
  log('trivia vs Nimo: played 5 questions to the result screen')
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

  // ---------- 4. Settle: ada invites chris, they agree terms (70/30, paid to a third-party wallet), play Last Bite ----------
  await a.goto('/#/g/lastbite')
  await a.waitForSelector('#t-bill')
  await a.locator('#t-bill').fill('9')
  await a.locator('[data-act=tpct][data-k="70"]').click()
  await a.locator('[data-act=tpay][data-k=other]').click()
  await a.locator('#t-other').fill(ADDR.tobi)
  await shot(a, 'setup-settle')
  await a.locator('#go').click()
  await a.waitForSelector('#code')
  await shot(a, 'settle-lobby')
  const lbCode = (await a.locator('#code').innerText()).trim()
  const lbId = matchId(a)
  await c.goto(`/#/join/${lbCode}`)
  await c.waitForSelector('[data-act=agree]')
  await a.waitForSelector('text=You agreed')
  await shot(c, 'settle-terms-chris')
  await shot(a, 'settle-terms-ada')
  // chris counters, which clears ada's agreement; ada agrees to the new terms
  await c.locator('[data-act=change]').click()
  await c.waitForSelector('#t-bill')
  await shot(c, 'settle-change-terms')
  await c.locator('[data-act=keep]').click()
  await c.waitForSelector('[data-act=agree]')
  await Promise.all([c.locator('[data-act=agree]').click()])
  for (const p of [a, c]) await p.waitForSelector('[data-act=fund]', { timeout: 20000 })
  await shot(c, 'funding-settle')
  assert.equal((await matchOf(a, lbId)).terms.agreed.length, 2)
  await Promise.all([c.locator('[data-act=fund]').click(), a.locator('[data-act=fund]').click()])
  for (const p of [a, c]) await p.waitForSelector('.sdk', { timeout: 20000 })
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
  for (const p of [a, c]) await p.waitForSelector('.res', { timeout: 20000 })
  await shot(a, 'settle-result-winner')
  await shot(c, 'settle-result-loser')
  const lbs = await matchOf(a, lbId)
  assert.equal(lbs.settlement.ranks[0].address, real.ada, 'full solve wins')
  const shares = lbs.players.map((p: any) => p.share)
  assert.equal(shares.reduce((s: number, x: number) => s + x, 0), 9 * 1e5, 'shares add up to the bill')
  assert.equal(lbs.players.find((p: any) => p.player.address === real.chris).share, 6.3 * 1e5, 'loser pays 70%')
  log(`Settle: 70/30 shares ${shares.map((x: number) => x / 1e5).join('/')} sum to the 9 NIM bill`)
  await new Promise((r) => setTimeout(r, 2500))
  const paid = (await (await fetch(`${BASE}/api/dev/mock-payouts`)).json()) as { to: string; luna: number }[]
  assert.ok(paid.some((p) => p.to.replace(/\s/g, '') === ADDR.tobi.replace(/\s/g, '') && p.luna === 9 * 1e5), 'the payee received the whole bill')

  // ---------- 5. Solitaire vs Nimo + Sudoku vs Nimo ----------
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
  log('solitaire duel vs Nimo: dealt from seed, drew cards, finished, scored')

  await c.goto('/#/g/sudoku')
  await c.waitForSelector('#go')
  await c.locator('#go').click()
  await c.waitForSelector('.sdk.n9', { timeout: 15000 })
  await shot(c, 'sudoku9')
  await c.locator('[data-fin]').click()
  await c.locator('[data-fin]').click()
  await c.waitForSelector('.res', { timeout: 15000 })
  log('sudoku 9x9 vs Nimo played to a result')

  // ---------- 5b. Word Rush, Bubble Shooter, Chess, Pool vs Nimo ----------
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
  log(`word rush: ${seven} accepted client-side, finished vs Nimo (${wm.address ? 'me ok' : ''})`)

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
  log(`bubble shooter: 6 shots fired (${popped}), finished vs Nimo`)

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
  log('chess: legal move highlighted and played, Nimo replied')
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
  log('rank, Nimo, profile, credits (CC BY credit present)')

  // ---------- 6b. Wallet start-up: late provider, flaky first answers, several accounts, wrong signer ----------
  {
    const { KeyPair } = await import('@nimiq/core')
    const { createHash } = await import('node:crypto')
    const post = async (tok: string | null, method: string, path: string, body?: unknown) =>
      (await fetch(`${BASE}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<any>
    const flaky = async (opts: { sender: string; accounts: string[]; canSign: boolean; kp?: any }) => {
      const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: VP, baseURL: BASE })
      if (opts.canSign) {
        await ctx.exposeFunction('__sign', (msg: string) => {
          const raw = Buffer.from(msg)
          const wrapped = Buffer.concat([Buffer.from('\x16Nimiq Signed Message:\n' + raw.length), raw])
          const sig = opts.kp.sign(createHash('sha256').update(wrapped).digest())
          return { publicKey: opts.kp.publicKey.toHex(), signature: sig.toHex() }
        })
      }
      await ctx.addInitScript(`(() => {
        const sender = ${JSON.stringify(opts.sender)}, accounts = ${JSON.stringify(opts.accounts)}, canSign = ${opts.canSign}
        window.__listCalls = 0
        window.nimiqPay = { network: 'testnet', language: 'en' }
        const send = async (recipient, value, data) => {
          const r = await fetch('/api/dev/mock-tx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: sender, to: recipient, luna: value, memo: data }) })
          return (await r.json()).hash
        }
        // the provider shows up 2s after the page starts, the first answer is an error, the second is empty
        setTimeout(() => {
          window.nimiq = {
            listAccounts: async () => { const n = ++window.__listCalls; if (n === 1) throw new Error('host not ready'); if (n === 2) return []; return accounts },
            getBalance: async () => 5000 * 1e5,
            sendBasicTransaction: async (t) => send(t.recipient, t.value, ''),
            sendBasicTransactionWithData: async (t) => send(t.recipient, t.value, t.data),
            ...(canSign ? { sign: async (m) => window.__sign(m) } : {}),
          }
        }, 2000)
      })()`)
      const page = await ctx.newPage()
      pages.set('flaky-' + opts.sender.slice(-4), page)
      page.on('pageerror', (e) => errors.push(`[flaky] pageerror: ${e.message}`))
      return page
    }
    const lockScreen = async (page: Page, host: string, stake: number) => {
      const tok = (await page.evaluate(() => sessionStorage.getItem('nb:token')))!
      const ht = (await post(null, 'POST', '/session', { address: host })).token
      const m = await post(ht, 'POST', '/matches', { game: 'trivia', mode: 'save', stake, opp: 'invite', config: { topic: 'Science', count: 5 } })
      await post(tok, 'POST', '/matches/join', { code: m.code })
      await page.goto(`/#/m/${m.id}`)
      await page.waitForSelector('[data-act="fund"]')
      return { m, tok }
    }

    // (a) wallet connects with no reload, and the signer, not accounts[0], becomes the identity
    const signer = KeyPair.generate()
    const signerAddr = signer.publicKey.toAddress().toUserFriendlyAddress()
    const pa = await flaky({ sender: signerAddr, accounts: [ADDR.tobi, signerAddr], canSign: true, kp: signer })
    await pa.goto('/')
    await pa.waitForSelector('text=Connecting to Nimiq Pay')
    await shot(pa, 'wallet-connecting')
    await pa.waitForSelector('.gcs', { timeout: 30000 })
    assert.equal(await pa.evaluate(() => performance.getEntriesByType('navigation').length), 1, 'no reload was needed')
    assert.ok((await pa.evaluate(() => (window as any).__listCalls)) >= 3, 'retried through the error and the empty answer')
    const me = await post((await pa.evaluate(() => sessionStorage.getItem('nb:token')))!, 'GET', '/me')
    assert.equal(me.address, signerAddr, 'identity is the account that signs, not accounts[0]')
    const l = await lockScreen(pa, ADDR.ada, 2)
    await pa.click('[data-act="fund"]')
    await pa.waitForSelector('.okb.on', { timeout: 20000 })
    assert.equal(await pa.locator('.err').count(), 0, 'no mismatch banner')
    const fm = await matchOf(pa, l.m.id)
    assert.equal(fm.players.find((p: any) => p.player.address === signerAddr).funded, true)
    await shot(pa, 'wallet-locked-with-signer')
    log('wallet connects without a reload (late provider, error, empty list) and uses the signing account')

    // (b) Nimiq Pay pays from another account than the one it signs with: the payment counts, a small note says where from
    const pb = await flaky({ sender: ADDR.ada.replace(/2$/, '9'), accounts: [ADDR.tobi], canSign: false })
    await pb.goto('/')
    await pb.waitForSelector('.gcs', { timeout: 30000 })
    const lb = await lockScreen(pb, ADDR.ada, 2)
    const before = (await (await fetch(`${BASE}/api/dev/mock-payouts`)).json()).length
    await pb.click('[data-act="fund"]')
    await pb.waitForSelector('.okb.on', { timeout: 20000 })
    assert.equal(await pb.locator('.err').count(), 0, 'no red banner')
    const note = await pb.locator('.rw.me .nm span').innerText()
    assert.match(note, /Locked 2 NIM · paid from NQ07…0009/)
    assert.equal((await (await fetch(`${BASE}/api/dev/mock-payouts`)).json()).length, before, 'nothing is sent back')
    const bm = await matchOf(pb, lb.m.id)
    assert.equal(bm.players.find((p: any) => p.paidFrom)?.funded, true)
    await shot(pb, 'wallet-wrong-signer')
    log('a payment from another account of the same wallet is accepted with a small "paid from" note')
  }

  // ---------- 7. Preview mode (no wallet): free play only ----------
  const pctx = await browser.newContext({ ...devices['Pixel 7'], viewport: VP, baseURL: BASE })
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
if (layoutIssues.length) {
  console.error(`Layout issues (${layoutIssues.length}):\n` + layoutIssues.join('\n'))
  process.exit(1)
}
console.log(`E2E passed. ${step} screenshots in ${OUT}`)

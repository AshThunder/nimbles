// Home screen horizontal overflow check at narrow phone widths, plus a 360px screenshot, on the mock chain with seeded data.
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
const OUT = process.argv[2] || join(import.meta.dirname, 'out', 'overflow')
mkdirSync(OUT, { recursive: true })
const { createApp } = await import('../../server/index')
const app = await createApp({ dataDir: mkdtempSync(join(tmpdir(), 'nimbles-shots-')), persist: false })
const PORT = 8798
await new Promise<void>((r) => app.server.listen(PORT, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${PORT}`

let W = 390
async function open(browser: Browser, who: keyof typeof ADDR, htlc = false): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: W, height: 800 }, deviceScaleFactor: 2, baseURL: BASE })
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

const ROUTES = ['/']
const browser = await chromium.launch()
let bad = 0
try {
  for (const w of [320, 360, 375, 390, 412]) {
    W = w
    const p = await open(browser, 'chris')
    for (const r of ROUTES) {
      await p.evaluate((r) => { location.hash = r }, r)
      await p.waitForTimeout(900)
      const res = await p.evaluate(() => {
        const vw = document.documentElement.clientWidth
        const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
        const wide: string[] = []
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const b = (el as HTMLElement).getBoundingClientRect()
          if (b.width === 0 || getComputedStyle(el).position === 'fixed' && el.tagName === 'CANVAS') continue
          let clipped = false
          for (let a = el.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'hidden' || o === 'auto' || o === 'scroll' || o === 'clip') { const ab = a.getBoundingClientRect(); if (ab.right <= vw + 0.5 && ab.left >= -0.5) { clipped = true; break } } }
          if (!clipped && (b.right > vw + 0.5 || b.left < -0.5)) wide.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`.slice(0, 60) + ` ${Math.round(b.left)}..${Math.round(b.right)}`)
        }
        // cards cut off inside a scroller that is itself on screen
        for (const el of Array.from(document.querySelectorAll('.strk,.jarc,.card,.sdq,.bnq,.quest,.duo'))) { const b = el.getBoundingClientRect(); if (b.width && (b.right > vw + 0.5)) wide.push('CARD ' + (el as HTMLElement).className + ' ' + Math.round(b.right)) }
        return { vw, sw, wide: [...new Set(wide)].slice(0, 6) }
      })
      if (res.sw > res.vw || res.wide.length) { bad++; console.log(`OVERFLOW ${w}px ${r} scrollWidth ${res.sw}/${res.vw}`, res.wide.join(' | ')) }
      if (w === 360 || w === 320) await p.screenshot({ path: join(OUT, `w${w}-home.png`), fullPage: true })
    }
    await p.context().close()
  }
  console.log(bad ? `${bad} screens overflow` : 'no horizontal overflow on any screen')
} finally { await browser.close(); app.close() }

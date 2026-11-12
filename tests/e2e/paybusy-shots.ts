// Screenshots of the Nimiq Pay busy handling on the mock chain: syncing state, busy card, Quick match count,
// payout banner, trivia generating. Usage: a mock server on NB_BASE (default http://127.0.0.1:8797), then tsx this file.
import { chromium, devices, type Browser } from 'playwright'
const BASE = process.env.NB_BASE || 'http://127.0.0.1:8797'
const OUT = process.env.NB_OUT || '/tmp/nbshots'
const W = Number(process.env.NB_W || 390)
const ADDR = { chris: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0011', ada: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0012' }

async function player(browser: Browser, name: keyof typeof ADDR, busy: boolean) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: W, height: 844 }, baseURL: BASE })
  await ctx.addInitScript(`(() => {
    const addr = ${JSON.stringify(ADDR[name])}
    let cons = 0, sends = 0
    const call = async (recipient, value, data) => {
      const r = await fetch('/api/dev/mock-tx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: addr, to: recipient, luna: value, memo: data }) })
      return (await r.json()).hash
    }
    const busy = ${busy}
    window.nimiq = {
      listAccounts: async () => [addr],
      getBalance: async () => 5000 * 1e5,
      isConsensusEstablished: async () => !busy || ++cons > 2,
      sendBasicTransaction: async (t) => call(t.recipient, t.value, ''),
      sendBasicTransactionWithData: async (t) => {
        if (busy && ++sends === 1) { const e = new Error('Failed to send payment transaction: A transaction is still pending. Wait for it to resolve before sending another.'); e.code = -32603; throw e }
        return call(t.recipient, t.value, t.data)
      },
    }
    window.nimiqPay = { network: 'testnet', language: 'en' }
    localStorage.setItem('nb:pay-approved', '1')
  })()`)
  const page = await ctx.newPage()
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(`[${name}] ${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => console.log(`[${name}] pageerror: ${e.message}`))
  await page.goto('/')
  await page.waitForSelector('.gcs')
  return page
}
const token = (p: any) => p.evaluate(() => sessionStorage.getItem('nb:token'))
const api = async (p: any, method: string, path: string, body?: unknown) => p.evaluate(async ([m, u, b, t]: any) => (await fetch('/api' + u, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined })).json(), [method, path, body, await token(p)])

async function trivia(chris: any) {
  // trivia generating (slow the create so the label is visible)
  await chris.route('**/api/matches', async (r: any) => { if (r.request().method() === 'POST') await new Promise((res) => setTimeout(res, 2500)); await r.continue() })
  await chris.goto('/#/g/trivia')
  await chris.waitForSelector('#go')
  await chris.screenshot({ path: `${OUT}/7a-trivia-setup.png` })
  if (await chris.locator('#topic').count()) { await chris.locator('#topic').fill('Space'); await chris.locator('#topic').press('Enter') }
  else if (await chris.locator('[data-topic]').count()) await chris.locator('[data-topic]').first().click()
  await chris.locator('#go').click()
  await chris.waitForSelector('.gen')
  await chris.waitForTimeout(300)
  await chris.screenshot({ path: `${OUT}/7-trivia-generating.png` })
  await chris.locator('#go').screenshot({ path: `${OUT}/7b-go.png` })
  console.log('go disabled:', await chris.locator('#go').isDisabled())
}

const browser = await chromium.launch()
try {
  if (process.env.NB_ONLY_TRIVIA) {
    const chris = await player(browser, 'chris', false)
    await trivia(chris)
    process.exit(0)
  }
  const ada = await player(browser, 'ada', false)
  const chris = await player(browser, 'chris', true)
  // ada waits in Quick match: chris's home shows the count inside the button
  const lob = await api(ada, 'POST', '/matches', { game: 'darts', mode: 'win', stake: 2, opp: 'auto', noNearby: true })
  await chris.reload(); await chris.waitForSelector('.gcs')
  await chris.waitForSelector('#qmn:not([hidden])', { timeout: 15000 })
  console.log('badge:', await chris.locator('#qmn').innerText())
  await chris.locator('.glab').scrollIntoViewIfNeeded()
  await chris.screenshot({ path: `${OUT}/1-home-badge.png` })
  await chris.locator('.qm').screenshot({ path: `${OUT}/1b-qm.png` })
  // payout banner
  await chris.evaluate(() => localStorage.setItem('nb:paid-at', String(Date.now())))
  await chris.reload(); await chris.waitForSelector('.pbn')
  await chris.screenshot({ path: `${OUT}/2-home-banner.png` })
  // chris joins: funding. ada locks first
  const j = await api(chris, 'POST', '/matches/join', { code: lob.code })
  await chris.goto('/#/m/' + j.id)
  await chris.waitForSelector('[data-act=fund]')
  await chris.screenshot({ path: `${OUT}/3-lock.png` })
  await chris.locator('[data-act=fund]').click()
  await chris.waitForSelector('.syncb', { timeout: 20000 })
  await chris.waitForTimeout(1200)
  await chris.screenshot({ path: `${OUT}/4-syncing.png` })
  // after the retries it pays, Pay throws -32603 once: the busy card
  await chris.waitForSelector('.paycard', { timeout: 90000 })
  await chris.screenshot({ path: `${OUT}/5-busy-card.png` })
  const html = await chris.content()
  console.log('raw code shown:', /-32603|still pending/.test(await chris.locator('#app').innerText()))
  await chris.locator('[data-act=retrypay]').click()
  await chris.waitForFunction(() => !document.querySelector('[data-act=fund]') && !document.querySelector('.paycard'), null, { timeout: 60000 })
  await chris.waitForTimeout(800)
  await chris.screenshot({ path: `${OUT}/6-locked.png` })
  const m = await api(chris, 'GET', '/matches/' + j.id)
  console.log('chris funded:', m.players.find((p: any) => p.player.address.replace(/ /g, '') === ADDR.chris.replace(/ /g, ''))?.funded, 'status', m.status)
  void html
  await trivia(chris)
} finally {
  await browser.close()
}

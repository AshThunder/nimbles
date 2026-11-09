import { chromium } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
process.env.CHAIN = 'mock'
delete process.env.GEMINI_API_KEY
const { createApp } = await import('../../server/index')
const app = await createApp({ dataDir: mkdtempSync(join(tmpdir(), 'nb-cc-')), persist: false })
const PORT = 8798, BASE = `http://127.0.0.1:${PORT}`
await new Promise<void>((r) => app.server.listen(PORT, '127.0.0.1', r))
const browser = await chromium.launch()
const addr = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0005'
const mk = async (mode: 'ok' | 'hang' | 'deny', approved: boolean) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, baseURL: BASE })
  await ctx.addInitScript(`(() => {
    window.__calls = 0; window.__release = null
    window.nimiqPay = { network: 'testnet', language: 'en' }
    if (${approved}) localStorage.setItem('nb:pay-approved', '1')
    localStorage.setItem('nb:muted', '1')
    window.nimiq = {
      listAccounts: () => { window.__calls++; if ('${mode}' === 'deny') return Promise.reject({ code: 4001, type: 'PERMISSION_DENIED', message: 'denied' })
        if ('${mode}' === 'hang' && window.__calls === 1) return new Promise((r) => { window.__release = () => r([${JSON.stringify(addr)}]) })
        return Promise.resolve([${JSON.stringify(addr)}]) },
      getBalance: async () => 5000 * 1e5,
      sendBasicTransaction: async () => 'x', sendBasicTransactionWithData: async () => 'x',
    }
  })()`)
  return ctx.newPage()
}
const calls = (p: any) => p.evaluate(() => (window as any).__calls)

// 1. first open: button, no request
let p = await mk('ok', false)
await p.goto('/')
await p.waitForSelector('#connect-wallet', { timeout: 15000 })
assert.equal(await calls(p), 0)
await p.waitForTimeout(400)
await p.screenshot({ path: '/workspace/nimbles-submit/campaign/v4/connect-button.png' })
await p.click('#connect-wallet')
await p.waitForSelector('.gcs', { timeout: 20000 })
assert.ok((await calls(p)) >= 1)
console.log('ok first open: button, 0 calls before tap, home loaded after tap')

// 2. returning: auto connect
p = await mk('ok', true)
const t0 = Date.now()
await p.goto('/')
await p.waitForSelector('.gcs', { timeout: 20000 })
console.log(`ok returning user auto-connects (${Date.now() - t0}ms)`)

// 3. hanging host: button after ~8s, tap reuses the pending request, late approval continues
p = await mk('hang', true)
await p.goto('/')
await p.waitForSelector('#connect-wallet', { timeout: 20000 })
assert.equal(await calls(p), 1)
await p.screenshot({ path: '/tmp/connect-timeout.png' })
await p.click('#connect-wallet')
await p.waitForTimeout(1500)
assert.equal(await calls(p), 1, 'no second request while one is pending')
await p.evaluate(() => (window as any).__release())
await p.waitForSelector('.gcs', { timeout: 20000 })
console.log('ok hang: button after timeout, tap reused pending request, approval continued without a new request')

// 4. denied: flag cleared, denied screen with button
p = await mk('deny', true)
await p.goto('/')
await p.waitForSelector('#connect-wallet', { timeout: 20000 })
assert.equal(await p.evaluate(() => localStorage.getItem('nb:pay-approved')), null)
assert.match(await p.innerText('body'), /declined/)
await p.screenshot({ path: '/tmp/connect-denied.png' })
console.log('ok denied: flag cleared, declined message with Connect wallet')

// 5. preview outside Pay
const c5 = await browser.newContext({ viewport: { width: 360, height: 760 }, baseURL: BASE })
p = await c5.newPage()
await p.goto('/?preview')
await p.waitForSelector('.gcs', { timeout: 20000 })
console.log('ok preview mode outside Nimiq Pay')
await browser.close(); app.server.close(); process.exit(0)

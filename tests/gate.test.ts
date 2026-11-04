import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/index'


process.env.CHAIN = 'mock'
delete process.env.NIMBLES_UNLOCK_ALL // the shipped setup: held-back games stay closed
process.env.GEMINI_API_KEY = ''

let app: Awaited<ReturnType<typeof createApp>>
let base = ''
const addr = (n: number) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const s = Array.from({ length: 32 }, (_, i) => chars[(i * 7 + n * 5 + 11) % chars.length]).join('')
  return 'NQ12 ' + s.match(/.{4}/g)!.join(' ')
}
before(async () => {
  app = await createApp({ persist: false })
  await new Promise<void>((r) => app.server.listen(0, r))
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api`
})
after(() => app.close())
async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, j: (await res.json()) as any }
}
const login = async (a: string, name: string) => (await call(null, 'POST', '/session', { address: a, name })).j.token as string


test('shipped setup: Darts opens in every mode, the held-back games and Splat Settle are refused, the config says so', async () => {
  const t = await login(addr(1), 'Ada')
  assert.equal((await call(t, 'POST', '/matches', { game: 'darts', mode: 'play', opp: 'pip' })).status, 200)
  for (const game of ['blocks', 'spider', 'speedmath', 'dominoes', 'blitz', 'bowling', 'carrom', 'ghost']) {
    const r = await call(t, 'POST', '/matches', { game, mode: 'play', opp: 'pip' })
    assert.equal(r.status, 400, game)
    assert.match(r.j.error, /coming soon/)
  }
  const sp = await call(t, 'POST', '/matches', { game: 'splat', mode: 'settle', opp: 'invite', config: { seats: 3 }, terms: { bill: 3, pct: 100, payee: 'me' } })
  assert.equal(sp.status, 400)
  assert.match(sp.j.error, /coming soon/)
  assert.equal((await call(t, 'POST', '/matches', { game: 'splat', mode: 'play', opp: 'pip', config: { seats: 3 } })).status, 200)
  const cfg = await call(null, 'GET', '/config')
  assert.ok(!cfg.j.unlockAll)
})

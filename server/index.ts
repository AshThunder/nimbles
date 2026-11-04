import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, ApiError } from './engine'
import { Store } from './store'
import { MockChain, makeChain } from './chain'
import { aiStatus, parseReceipt } from './ai'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

function loadEnv() {
  const f = join(ROOT, '.env')
  if (!existsSync(f)) return
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined && m[2] !== '') process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
}

async function readBody(req: IncomingMessage, limit: number): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > limit) throw new ApiError(413, 'Request too large')
    chunks.push(c as Buffer)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ApiError(400, 'Bad JSON')
  }
}

const buckets = new Map<string, { n: number; t: number }>()
function limit(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now - b.t > windowMs) buckets.set(key, { n: 1, t: now })
  else if (++b.n > max) throw new ApiError(429, 'Slow down a little')
}

export async function createApp(opts: { dataDir?: string; persist?: boolean } = {}) {
  loadEnv()
  const dataDir = opts.dataDir ?? join(ROOT, 'data')
  const store = new Store(dataDir, opts.persist ?? true)
  const chain = await makeChain(dataDir)
  const engine = new Engine(store, chain)
  const distDir = join(ROOT, 'dist')

  const send = (res: ServerResponse, status: number, body: unknown) => {
    const s = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(s)
  }

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    const method = req.method ?? 'GET'
    const ip = req.socket.remoteAddress ?? '?'
    const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    const q = new URL(req.url ?? '/', 'http://x').searchParams
    let m: RegExpMatchArray | null

    if (method === 'GET' && path === '/config') {
      return send(res, 200, {
        chain: chain.kind, network: chain.network, escrow: chain.escrowAddress, lockDays: engine.lockDays, ai: aiStatus(),
        mock: chain.kind === 'mock', serverNow: Date.now(),
      })
    }
    if (method === 'POST' && path === '/session') {
      limit('sess:' + ip, 60, 60_000)
      const b = await readBody(req, 4096)
      return send(res, 200, engine.session(b.address, b.name, b.avatar))
    }
    // dev only: the mocked Nimiq Pay provider registers the tx it pretends to send
    if (method === 'POST' && path === '/dev/mock-tx' && chain instanceof MockChain) {
      const b = await readBody(req, 4096)
      return send(res, 200, { hash: chain.register({ from: b.from, to: b.to, luna: Number(b.luna), memo: String(b.memo ?? '') }) })
    }
    if (method === 'GET' && path === '/dev/mock-payouts' && chain instanceof MockChain) return send(res, 200, chain.paid)
    if (method === 'GET' && path === '/vault/puzzle') {
      // the puzzle is public (same for everyone each day); the solution stays on the server
      const p = engine.vaultPuzzle()
      return send(res, 200, { day: new Date().toISOString().slice(0, 10), size: p.size, puzzle: p.puzzle })
    }

    const me = engine.auth(tok)
    limit('u:' + me, 600, 60_000)
    if (method === 'GET' && path === '/me') return send(res, 200, engine.profile(me))
    if (method === 'POST' && path === '/me') {
      const b = await readBody(req, 4096)
      return send(res, 200, engine.setProfile(me, b.name, b.avatar))
    }
    if (method === 'GET' && path === '/leaderboard') return send(res, 200, engine.leaderboard(me, q.get('scope') === 'friends' ? 'friends' : 'global'))
    if (method === 'GET' && path === '/matches') return send(res, 200, engine.mine(me))
    if (method === 'POST' && path === '/matches') {
      limit('create:' + me, 20, 60_000)
      return send(res, 200, await engine.create(me, await readBody(req, 16384)))
    }
    if (method === 'POST' && path === '/matches/join') {
      limit('join:' + ip, 30, 60_000)
      const b = await readBody(req, 1024)
      return send(res, 200, await engine.join(me, b.code))
    }
    if ((m = path.match(/^\/matches\/([a-f0-9]+)(?:\/(\w+))?$/))) {
      const [, id, action] = m
      if (method === 'GET' && !action) return send(res, 200, engine.get(id, me))
      if (method === 'POST') {
        const b = await readBody(req, 65536)
        if (action === 'fund') return send(res, 200, await engine.fund(me, id, b.txHash))
        if (action === 'cancel') return send(res, 200, await engine.cancel(me, id))
        if (action === 'answer') return send(res, 200, engine.answer(me, id, b))
        if (action === 'progress') return send(res, 200, engine.progress(me, id, Number(b.score)))
        if (action === 'result') return send(res, 200, engine.result(me, id, b))
      }
    }
    if (method === 'POST' && path === '/vault/solve') return send(res, 200, engine.vaultSolve(me, (await readBody(req, 4096)).grid))
    if (method === 'POST' && path === '/vault/deposit') {
      const b = await readBody(req, 4096)
      return send(res, 200, await engine.vaultDeposit(me, b.txHash, Number(b.amount)))
    }
    if (method === 'POST' && path === '/jar/withdraw') {
      limit('wd:' + me, 5, 60_000)
      return send(res, 200, await engine.withdrawJar(me))
    }
    if (method === 'POST' && path === '/ai/receipt') {
      limit('ai:' + me, 8, 60_000)
      const b = await readBody(req, 8_000_000)
      try {
        return send(res, 200, await parseReceipt(b))
      } catch (e: any) {
        throw new ApiError(422, e?.message?.startsWith('Pip') || e?.message?.startsWith('Send') ? e.message : 'Pip could not read that receipt. Try a clearer photo or enter the total')
      }
    }
    throw new ApiError(404, 'Not found')
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    if (!existsSync(distDir)) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      return res.end('Nimbles API is running. Build the web app with `npm run build`, or run `npm run dev`.')
    }
    let file = normalize(join(distDir, path === '/' ? 'index.html' : path))
    if (!file.startsWith(distDir)) file = join(distDir, 'index.html')
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(distDir, 'index.html')
    const ext = extname(file)
    const immutable = /\/assets\/.*-[\w-]{8}\./.test(file)
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' })
    res.end(readFileSync(file))
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url.pathname.slice(4))
      else serveStatic(req, res, decodeURIComponent(url.pathname))
    } catch (e: any) {
      if (e instanceof ApiError) send(res, e.status, { error: e.message })
      else {
        console.error('[api]', e)
        send(res, 500, { error: 'Something went wrong' })
      }
    }
  })
  const timer = setInterval(() => engine.tickAll(), 1000)
  timer.unref()
  return { server, engine, chain, store, close: () => { clearInterval(timer); store.flush(); server.close() } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp()
  const port = Number(process.env.PORT ?? 8787)
  app.server.listen(port, '0.0.0.0', () => console.log(`[nimbles] api on :${port}, chain=${app.chain.kind}, ai=${aiStatus().gemini ? 'gemini' : 'fallback bank'}`))
  process.on('SIGINT', () => { app.close(); process.exit(0) })
}

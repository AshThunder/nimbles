// Small UI helpers: icons, avatars, sounds, haptics, confetti, toasts.

const raw = (g: Record<string, string>) =>
  Object.fromEntries(Object.entries(g).map(([k, v]) => [k.replace(/^.*\/(.+)\.svg$/, '$1'), v]))

const ICONS = raw(import.meta.glob('../../assets/icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)
const GLYPHS = raw(import.meta.glob('../../assets/games/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Inline Lucide icon that follows currentColor. */
export function ic(name: string, cls = ''): string {
  const s = ICONS[name]
  if (!s) return ''
  return s.replace(/<svg[^>]*>/, (m) => m.replace(/\s(width|height|class)="[^"]*"/g, '').replace('<svg', `<svg class="i ${cls}"`))
}
export const glyph = (id: string) => (GLYPHS[id] ?? '').replace(/<svg([^>]*)>/, (_m, a) => `<svg${a.replace(/\s(width|height)="[^"]*"/g, '')} class="gl">`)
export const GLYPH_BG: Record<string, string> = {
  trivia: '#1F78C4', solitaire: '#1F8A5B', chess: '#1F2348', pool: '#1F7F73', sudoku: '#F4B323', bubble: '#F29AAE', word: '#D0432E', lastbite: '#EBD6A0', vault: '#1F2348',
}
export const pipImg = (mood = 'happy', cls = '') => `<img class="${cls}" src="/pip/pip-${mood}.svg" alt="" width="52" height="52">`
export const avatar = (name: string, cls = 'av') =>
  name === 'pip' ? `<img class="${cls}" src="/pip/pip-cool.svg" alt="">` : `<img class="${cls}" src="/avatars/${esc(name)}.svg" alt="">`
export const lvBadge = (n: number, size = 24) => `<img class="lvb" src="/badges/levels/level-${Math.max(1, Math.min(50, n))}.svg" alt="Level ${n}" style="width:${size}px;height:${size}px">`

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[]

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** crypto.randomUUID needs a secure context; Nimiq Pay dev URLs are plain http. */
export function randomHex(bytes = 8): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------- sound + haptics ----------------

let muted = localStorage.getItem('nb:muted') === '1'
export const isMuted = () => muted
export function setMuted(v: boolean) {
  muted = v
  localStorage.setItem('nb:muted', v ? '1' : '0')
}
const cache = new Map<string, HTMLAudioElement>()
export type Sfx =
  | 'ui/tap' | 'ui/select' | 'ui/confirm' | 'ui/back' | 'ui/open' | 'ui/close' | 'ui/correct' | 'ui/wrong' | 'ui/error' | 'ui/tile'
  | 'ui/countdown-tick' | 'ui/countdown-last' | 'ui/countdown-go' | 'reward/win-big' | 'reward/lose' | 'reward/draw' | 'reward/coin' | 'reward/xp'
  | 'reward/bonus' | 'reward/chest-open' | 'game/card-place' | 'game/card-slide' | 'game/card-shuffle' | 'game/chess-move' | 'game/chess-capture'
  | 'game/pool-hit' | 'game/pool-pocket' | 'game/bubble-pop' | 'game/bubble-shoot'
export function sfx(name: Sfx, volume = 0.6) {
  if (muted) return
  try {
    let a = cache.get(name)
    if (!a) {
      a = new Audio(`/sounds/${name}.mp3`)
      a.preload = 'auto'
      cache.set(name, a)
    }
    const c = a.paused ? a : (a.cloneNode() as HTMLAudioElement)
    c.volume = volume
    c.currentTime = 0
    void c.play().catch(() => {})
  } catch {
    /* audio is optional */
  }
}
export function buzz(pattern: number | number[] = 12) {
  if (muted) return
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* not supported */
  }
}
export const tap = () => {
  sfx('ui/tap', 0.4)
  buzz(8)
}

// ---------------- confetti ----------------

const COLORS = ['#F4B323', '#D0432E', '#1F78C4', '#F29AAE', '#FFFCF5', '#1F8A5B']
export function confetti(n = 90, root: HTMLElement = document.getElementById('app')!) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const cv = document.createElement('canvas')
  cv.className = 'cf-layer'
  const w = (cv.width = root.clientWidth)
  const h = (cv.height = root.clientHeight)
  root.appendChild(cv)
  const ctx = cv.getContext('2d')!
  const ps = Array.from({ length: n }, () => ({
    x: w / 2 + (Math.random() - 0.5) * 60, y: h * 0.35, vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 12 - 4,
    r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: COLORS[(Math.random() * COLORS.length) | 0], k: (Math.random() * 3) | 0, s: 4 + Math.random() * 5,
  }))
  let t = 0
  const step = () => {
    ctx.clearRect(0, 0, w, h)
    for (const p of ps) {
      p.vy += 0.35
      p.x += p.vx
      p.y += p.vy
      p.vx *= 0.99
      p.r += p.vr
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.r)
      ctx.fillStyle = p.c
      if (p.k === 0) ctx.fillRect(-p.s, -p.s / 2, p.s * 2, p.s)
      else if (p.k === 1) {
        ctx.beginPath()
        ctx.arc(0, 0, p.s / 2, 0, 7)
        ctx.fill()
      } else {
        ctx.beginPath()
        ctx.moveTo(0, -p.s)
        ctx.lineTo(p.s, p.s)
        ctx.lineTo(-p.s, p.s)
        ctx.fill()
      }
      ctx.restore()
    }
    if (++t < 150) requestAnimationFrame(step)
    else cv.remove()
  }
  requestAnimationFrame(step)
}

// ---------------- toast ----------------

export function toast(msg: string, ms = 3200) {
  const app = document.getElementById('app')!
  $('.toast', app)?.remove()
  const t = document.createElement('div')
  t.className = 'toast'
  t.setAttribute('role', 'status')
  t.textContent = msg
  app.appendChild(t)
  setTimeout(() => t.remove(), ms)
}

/** Event delegation: one listener per view root, handlers keyed by data-act. */
export function actions(root: HTMLElement, map: Record<string, (el: HTMLElement, ev: Event) => void | Promise<void>>) {
  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]')
    if (!el || !root.contains(el)) return
    const fn = map[el.dataset.act!]
    if (!fn) return
    const r = fn(el, ev)
    if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch((e) => toast(e?.message || 'Something went wrong'))
  })
}

export const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
export const shortAddr = (a: string) => a.replace(/\s/g, '').slice(0, 4) + '…' + a.replace(/\s/g, '').slice(-4)

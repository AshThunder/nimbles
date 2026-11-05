import { cosmeticOf } from '../../shared/rewards'
import type { Profile } from '../../shared/types'
import type { Config } from './api'
import type { Wallet } from './wallet'

export type Me = Profile & { vaultToday?: boolean }
/** balance: undefined = still loading, null = unavailable (show —), number = confirmed luna */
export const S: { cfg: Config; wallet: Wallet; me: Me; balance: number | null | undefined } = {} as never

// ---- tiny router ----
export type Cleanup = void | (() => void)
export type Screen = (root: HTMLElement, params: Record<string, string>) => Cleanup | Promise<Cleanup>
const routes: [RegExp, string[], Screen][] = []
export const route = (pattern: string, screen: Screen) => {
  const keys: string[] = []
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_m, k) => (keys.push(k), '([^/]+)')) + '$')
  routes.push([re, keys, screen])
}
let cleanup: Cleanup
let token = 0
export const go = (path: string) => {
  if (location.hash === '#' + path) void render()
  else location.hash = path
}
export async function render() {
  const my = ++token
  const path = location.hash.replace(/^#/, '') || '/'
  const root = document.getElementById('app')!
  if (typeof cleanup === 'function') cleanup()
  cleanup = undefined
  for (const [re, keys, screen] of routes) {
    const m = path.match(re)
    if (!m) continue
    const params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
    root.innerHTML = ''
    const view = document.createElement('div')
    view.className = 'view'
    root.appendChild(view)
    // the worn table theme tints the play screens only
    const th = S.me?.style?.theme && /^\/(m|g)\//.test(path) ? cosmeticOf(S.me.style.theme) : undefined
    if (th) { view.style.setProperty('--bg', th.tint); view.style.background = th.tint }
    const c = await screen(view, params)
    if (my !== token) {
      if (typeof c === 'function') c()
      return
    }
    cleanup = c
    return
  }
  go('/')
}

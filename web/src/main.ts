import './style.css'
import { api, setToken } from './api'
import { connect, adoptVerified, ConnectError } from './wallet'
import { S, go, render } from './state'
import { esc, pipImg, sfx } from './lib'
import './screens/home'
import './screens/setup'
import './screens/match'
import './screens/misc'
import './screens/jar'
import './screens/chests'
import { netBadge } from './ui'

const app = document.getElementById('app')!

function fatal(msg: string) {
  app.innerHTML = `<div class="view"><div class="scroll center" style="justify-content:center;gap:14px">${pipImg('sad')}<b style="font-size:22px">Cannot start Nimbles</b><div style="color:var(--ink2);max-width:300px">${esc(msg)}</div><button class="btn gold" onclick="location.reload()">Try again</button></div></div>`
}

const connecting = (msg: string, retry = false) => {
  app.innerHTML = `<div class="view"><div class="scroll center" style="justify-content:center;gap:12px">${pipImg('wink')}<b>${esc(msg)}</b>${retry ? '<button class="btn gold" id="again">Try again</button>' : ''}</div></div>`
  document.getElementById('again')?.addEventListener('click', () => void boot())
}

let booted = false
async function boot() {
  connecting('Starting Nimbles…')
  // ?join=NMB-XXXX becomes a hash route so links from outside Nimiq Pay still land on the right screen
  const q = new URLSearchParams(location.search)
  if (q.get('join')) location.hash = '/join/' + q.get('join')
  try {
    S.cfg = await api.config()
    try {
      S.wallet = await connect(S.cfg, (m) => connecting(m))
    } catch (e) {
      if (e instanceof ConnectError) return connecting(e.message, true)
      throw e
    }
    const saved = JSON.parse(localStorage.getItem('nb:profile') || '{}')
    const r = await api.session(S.wallet.address, saved.name, saved.avatar, S.wallet.proof)
    adoptVerified(S.wallet, r.profile.address, r.verified || S.wallet.verified)
    setToken(r.token)
    S.me = r.profile
    S.balance = await S.wallet.balance()
  } catch (e: any) {
    return fatal(e?.message ?? String(e))
  }
  if (booted) return void render()
  booted = true
  window.addEventListener('hashchange', () => void render())
  document.addEventListener('pointerdown', () => void 0, { once: true })
  await render()
  void netBadge
  void sfx
}
void boot()
void go

import './style.css'
import { api, setToken, setReauth, ApiErr } from './api'
import { connect, adoptVerified, ConnectError, sameAddress, deepLink } from './wallet'
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
  const openPay = deepLink()
  const appStore = 'https://apps.apple.com/app/nimiq-pay/id6471844738'
  const playStore = 'https://play.google.com/store/apps/details?id=com.nimiq.pay'
  app.innerHTML = `<div class="view"><div class="scroll center" style="justify-content:center;gap:14px;padding:24px 20px">${pipImg('sad')}<b style="font-size:22px">Cannot start Nimbles</b><div style="color:var(--ink2);max-width:300px">${esc(msg)}</div><div style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:320px;margin-top:4px"><button class="btn gold block" onclick="location.reload()">Try again</button><a class="btn ghost block" href="${openPay}">Open in Nimiq Pay</a><div style="display:flex;gap:8px"><a class="btn ghost sm" style="flex:1" href="${appStore}" target="_blank" rel="noopener">App Store</a><a class="btn ghost sm" style="flex:1" href="${playStore}" target="_blank" rel="noopener">Google Play</a></div></div></div></div>`
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
    // when the token runs out the server answers 401 and the app signs a fresh challenge, then retries the call
    setReauth(async () => {
      const w = S.wallet!
      const proof = w.signIn ? await w.signIn(() => {}) : undefined
      const nr = await api.session(w.address, saved.name, saved.avatar, proof)
      if (nr.verified && !sameAddress(nr.profile.address, w.address)) throw new ApiErr(401, 'Wallet account changed. Reload Nimbles')
      setToken(nr.token)
    })
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

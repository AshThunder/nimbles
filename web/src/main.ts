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
import './screens/social'
import './screens/admin'
import { netBadge, refreshBalance, openBalanceDialog } from './ui'

const app = document.getElementById('app')!

function fatal(msg: string) {
  const openPay = deepLink()
  const appStore = 'https://apps.apple.com/app/nimiq-pay/id6471844738'
  const playStore = 'https://play.google.com/store/apps/details?id=com.nimiq.pay'
  app.innerHTML = `<div class="view"><div class="scroll center" style="justify-content:center;gap:14px;padding:24px 20px">${pipImg('sad')}<b style="font-size:22px">Cannot start Nimbles</b><div style="color:var(--ink2);max-width:300px">${esc(msg)}</div><div style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:320px;margin-top:4px"><button class="btn gold block" onclick="location.reload()">Try again</button><a class="btn ghost block" href="${openPay}">Open in Nimiq Pay</a><div style="display:flex;gap:8px"><a class="btn ghost sm" style="flex:1" href="${appStore}" target="_blank" rel="noopener">App Store</a><a class="btn ghost sm" style="flex:1" href="${playStore}" target="_blank" rel="noopener">Google Play</a></div></div></div></div>`
}

const connecting = (msg: string) => {
  app.innerHTML = `<div class="view"><div class="scroll center" style="justify-content:center;gap:12px">${pipImg('wink')}<b>${esc(msg)}</b></div></div>`
}

/** Connect wallet screen. The tap starts the Nimiq Pay request while the app is in front, so its sheet shows on top. */
function connectScreen(e: ConnectError) {
  const title = e.kind === 'denied' ? 'Address not shared' : e.kind === 'needs-tap' ? 'Connect your wallet' : 'Not connected yet'
  app.innerHTML = `<div class="view"><div class="scroll center" style="justify-content:center;gap:14px;padding:24px 20px">${pipImg(e.kind === 'denied' ? 'sad' : 'wink')}<b style="font-size:22px">${title}</b><div style="color:var(--ink2);max-width:300px">${esc(e.message)}</div><button class="btn gold block" id="connect-wallet" style="max-width:320px;margin-top:4px">Connect wallet</button><div style="color:var(--muted);font-size:13px;line-height:18px;max-width:300px">Nimiq Pay will ask you to share your address with Nimbles.</div></div></div>`
  const btn = document.getElementById('connect-wallet') as HTMLButtonElement | null
  btn?.addEventListener('click', () => { btn.disabled = true; void boot({ userTap: true }) }, { once: true })
  // Approved after our timeout: carry on without another tap
  e.late?.then(() => { if (document.getElementById('connect-wallet') === btn) void boot() }, () => {})
}

let booted = false
let unsubAccounts: (() => void) | undefined
let resumeBound = false

function bindBalanceLifecycle() {
  unsubAccounts?.()
  unsubAccounts = S.wallet?.onAccountsChanged?.(() => { void refreshBalance() })
  if (resumeBound) return
  resumeBound = true
  // Coalesce resume signals: HTLC may have been replaced while backgrounded.
  let resumeTimer: ReturnType<typeof setTimeout> | undefined
  const onResume = () => {
    if (document.visibilityState === 'hidden') return
    clearTimeout(resumeTimer)
    resumeTimer = setTimeout(() => { void refreshBalance() }, 250)
  }
  document.addEventListener('visibilitychange', onResume)
  window.addEventListener('pageshow', onResume)
  window.addEventListener('focus', onResume)
}

async function boot(opts: { userTap?: boolean } = {}) {
  connecting('Starting Nimbles…')
  // ?join=NMB-XXXX becomes a hash route so links from outside Nimiq Pay still land on the right screen
  const q = new URLSearchParams(location.search)
  if (q.get('join')) location.hash = '/join/' + q.get('join')
  const inv = q.get('invite') || q.get('friend') // ?friend= kept for links already shared
  if (inv) location.hash = '/friend/' + inv
  if (location.pathname.replace(/\/$/, '') === '/admin' && !location.hash) location.hash = '/admin'
  try {
    // Config is cached so a Connect wallet tap goes straight to Nimiq Pay
    S.cfg ??= await api.config()
    try {
      S.wallet = await connect(S.cfg, (m) => connecting(m), opts)
    } catch (e) {
      if (e instanceof ConnectError) return connectScreen(e)
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
    bindBalanceLifecycle()
    await refreshBalance()
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

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement | null)?.closest?.('[data-act="balance"]')
  if (!el) return
  ev.preventDefault()
  openBalanceDialog()
})

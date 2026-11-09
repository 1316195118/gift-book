// 页面级动作：首页各按钮、账簿打开/解锁、导出入口等。
import { state as st, NO_PASSWORD_KEY, hashPassword, NO_PASSWORD_HASH, applyLargeText } from '../store.js'
import { api, ApiError } from './api.js'
import { openModal, closeModal, alert as showAlert, confirm as showConfirm } from './modal.js'
import { showTemplates, showSetup, showHome, loadEvents, startSession, endSession } from '../bootstrap.js'
import { copyOf, isSolemnEvent } from './content.js'
import { getHomeCategory, setHomeCategory } from './prefs.js'
import { readCache, cacheLedgerGifts } from './offline.js'
import { LedgerCrypto } from './crypto.js'

export { showTemplates, showSetup, showHome }

export const versionLabel = () => st.version || '--'

export function toggleLargeText() {
  applyLargeText(!st.largeText)
}

export function switchCategory(next) {
  if (next === st.homeCategory) return
  const label = next === 'white' ? '白事' : '红事'
  showConfirm('切换分类', `确定切换到 <strong class="quote-word">${label}</strong> 吗？<br><span class="confirm-note">切换后首页配色和最近账簿会随之变化。</span>`, async () => {
    setHomeCategory(next)
    st.homeCategory = next
    await loadEvents()
  })
}

export function showHelpDialog() {
  const copy = copyOf(null, st.homeCategory)
  openModal(
    '使用说明',
    {
      type: 'html',
      html: `
        <div class="help-intro">${copy.helpIntro}</div>
        <div class="help-steps">
          ${[
            ['选择分类', copy.helpStep1],
            ['填写账簿信息', copy.helpStep2],
            ['开始登记', copy.helpStep3],
            ['导出与打印', copy.helpStep4],
          ]
            .map(([title, desc], i) => `<div class="help-step"><div class="help-num">${i + 1}</div><div class="help-body"><div class="help-title">${title}</div><div class="help-desc">${desc}</div></div></div>`)
            .join('')}
        </div>
        <div class="help-tip">${copy.helpTip}</div>
        <div class="help-build">前端构建 ${st.build || '-'} · Vue 3 + Go</div>`,
    },
    [{ text: '知道了', class: 'themed-button-primary px-4 py-2 rounded' }],
  )
}

export function showChangelog() {
  import('./changelog.js').then(({ renderChangelog }) => {
    openModal('更新说明', { type: 'html', html: renderChangelog() }, [
      { text: '知道了', class: 'modal-btn-primary' },
    ])
  })
}

export async function showAccessModal() {
  const { AccessPanel } = await import('../components/dialogs.js')
  // 面板自带保存/取消按钮，弹窗底栏留空
  openModal('访问保护', { type: 'component', component: AccessPanel, props: { enabled: st.authEnabled } }, [])
}

export async function showAutoBackupModal() {
  const { AutoBackupPanel } = await import('../components/dialogs.js')
  openModal('自动备份', { type: 'component', component: AutoBackupPanel }, [])
}

export async function logout() {
  try {
    await api.logout()
  } catch {
    /* 忽略 */
  }
  endSession()
  location.reload()
}
export async function showNetworkDetails() {
  const { NetworkPanel } = await import('../components/dialogs.js')
  // 「立即重测」与底部「知道了」都在面板内，弹窗底栏不再重复放按钮
  openModal('网络状态', { type: 'component', component: NetworkPanel }, [])
}

// 打开一本账簿：无密码直接进入，有密码弹解锁窗。
export async function openEvent(eventOrId) {
  const id = typeof eventOrId === 'string' ? eventOrId : eventOrId?.id
  if (!id) return
  let event
  try {
    event = (await api.getEvent(id)).data
    st.offlineMode = false
  } catch (error) {
    const cached = readCache().events?.[id]
    if (!(error instanceof ApiError && error.code === 'NETWORK' && cached)) {
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') return
      showAlert('错误', '无法获取事件信息，请稍后重试。')
      return
    }
    event = cached
    st.offlineMode = true
  }
  if (!event) return
  if (!event.hasPassword) {
    st.currentEvent = event
    st.currentPassword = NO_PASSWORD_KEY
    startSession()
    return
  }
  const solemn = isSolemnEvent(event, st.homeCategory)
  openModal(
    '',
    {
      type: 'unlock',
      eventName: event.name,
      verifier: (password) => verifyLedgerPassword(event.id, password),
      onSuccess: (password) => {
        st.currentEvent = event
        st.currentPassword = password
        startSession()
      },
    },
    [],
    { size: 'unlock', theme: solemn ? 'theme-solemn' : 'theme-festive' },
  )
}

/** 向服务端校验管理密码（含错误次数限制）；返回 { ok, message }。 */
export async function verifyLedgerPassword(eventId, password) {
  try {
    await api.verifyEvent(eventId, ledgerKeyOf(password))
    return { ok: true }
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'LEDGER_KEY' || error.code === 'LEDGER_LOCKED')) {
      return { ok: false, message: error.message }
    }
    // 连不上服务器：用本机缓存的校验值离线核对，让断网时仍能进入账簿。
    const offline = offlineVerify(eventId, password)
    if (offline === true) return { ok: true, offline: true }
    if (offline === false) return { ok: false, message: '密码不正确（当前离线，用本机记录核对）' }
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') return { ok: false, message: error.message }
    throw error
  }
}

export const ledgerKeyOf = (password) =>
  !password || password === NO_PASSWORD_KEY ? NO_PASSWORD_HASH : hashPassword(password)

function offlineVerify(eventId, password) {
  const entry = readCache().ledgers?.[eventId]
  const params = readCache().events?.[eventId]?.kdf || st.currentEvent?.kdf
  if (!entry || !entry.verifier || !params) return null
  try {
    const keys = LedgerCrypto.deriveKeys(password, params)
    return LedgerCrypto.hmacSha256Hex2(keys.mac, 'giftbook-offline-verify') === entry.verifier
  } catch {
    return null
  }
}

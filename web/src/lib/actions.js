// 页面级动作：首页各按钮、账簿打开/解锁、导出入口等。
import { state as st, NO_PASSWORD_KEY, hashPassword, NO_PASSWORD_HASH, applyLargeText } from '../store.js'
import { api, ApiError } from './api.js'
import { openModal, closeModal, alert as showAlert, confirm as showConfirm } from './modal.js'
import { safeImport } from './lazy.js'
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
  showConfirm('切换分类', `确定切换到「${label}」吗？\n切换后首页配色和最近账簿会随之变化。`, async () => {
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
        <div class="help-features">
          <div class="help-features-title">还能做什么</div>
          ${copy.helpFeatures.map(([title, desc]) => `<div class="help-feature"><b>${title}</b><span>${desc}</span></div>`).join('')}
        </div>
        <div class="help-build">前端构建 ${st.build || '-'} · Vue 3 + Go</div>`,
    },
    [{ text: '知道了', class: 'themed-button-primary px-4 py-2 rounded' }],
  )
}

export function showChangelog() {
  // 旧页面在新版本部署后 import 旧 chunk 会 404；safeImport 会提示刷新而不是静默失败。
  safeImport(() => import('./changelog.js'), '更新说明').then((mod) => {
    if (!mod) return
    openModal('更新说明', { type: 'html', html: mod.renderChangelog() }, [
      { text: '知道了', class: 'modal-btn-primary' },
    ])
  })
}

// 首页版权行：展示许可要点；完整许可见仓库根目录 LICENSE。
export function showLicense() {
  openModal(
    '开源许可与版权',
    {
      type: 'html',
      html: `<div class="text-sm text-gray-700 space-y-2">
        <p><b>© 2026 Gift Book contributors</b></p>
        <p>本项目以 <b>MIT License</b> 开源：可自由使用、修改、分发（含商业用途），但需在副本或衍生作品中保留版权声明与本许可声明。</p>
        <p>软件按「现状」提供，不附带任何担保；账簿数据请自行定期备份。</p>
        <p class="text-xs text-gray-500">运行时依赖：Vue 3（MIT）；后端仅 Go 标准库（BSD）。完整许可见仓库根目录 LICENSE。</p>
      </div>`,
    },
    [{ text: '知道了', class: 'modal-btn-primary' }],
  )
}

export async function showAccessModal() {
  const mod = await safeImport(() => import('../components/dialogs.js'), '访问保护面板')
  if (!mod) return
  const { AccessPanel } = mod
  // 面板自带保存/取消按钮，弹窗底栏留空
  openModal('管理员密码', { type: 'component', component: AccessPanel, props: { enabled: st.authEnabled } }, [])
}

export async function showAutoBackupModal() {
  const mod = await safeImport(() => import('../components/dialogs.js'), '自动备份面板')
  if (!mod) return
  const { AutoBackupPanel } = mod
  openModal('自动备份', { type: 'component', component: AutoBackupPanel }, [])
}

export async function logout() {
  try {
    await api.logout()
  } catch {
    /* 忽略 */
  }
  // 退出管理员后连家庭会话一起清掉，回到「选择家庭」，
  // 否则刷新后会自动回到原家庭，看不出已经退出管理。
  try {
    await api.familyLogout()
  } catch {
    /* 忽略 */
  }
  endSession()
  location.reload()
}
export async function showNetworkDetails() {
  const mod = await safeImport(() => import('../components/dialogs.js'), '网络状态面板')
  if (!mod) return
  const { NetworkPanel } = mod
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
    [{ text: '取消', class: 'modal-btn-ghost' }],
    // 手机没有 ESC：解锁窗必须能点 ×、点「取消」或点遮罩退出，避免不输密码就被困住。
    { size: 'unlock', theme: solemn ? 'theme-solemn' : 'theme-festive', dismissable: true },
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

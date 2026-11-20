// 容器内自更新的前端入口：在「更新说明」弹窗里检查并安装新版本。
// 检查只读、任何页面可用；安装由服务端再做一次管理员校验。
import { apiRequest } from './api.js'
import { openModal, closeModal } from './modal.js'
import { escapeHtml } from './ledger-actions.js'
import { APP_VERSION } from './changelog.js'

let lastCheck = 0
let cached = null

async function check(force = false) {
  if (!force && cached && Date.now() - lastCheck < 60_000) return cached
  try {
    // 顺带取一次代理设置，弹窗里要回显；失败不影响检查结果。
    const [checkRes, statusRes] = await Promise.all([
      apiRequest('/api/update/check'),
      apiRequest('/api/update/status').catch(() => null),
    ])
    cached = { ...(checkRes?.data || {}), proxy: statusRes?.data?.proxy || '' }
    lastCheck = Date.now()
    return cached
  } catch (err) {
    return { available: false, error: err?.message || '检查失败', proxy: '' }
  }
}

// 后台自检：每 6 小时一次，只记录结果，不打扰用户；有更新时在设置里给提示。
let timer = null
export function startAutoCheck() {
  if (timer) return
  timer = setInterval(async () => {
    const info = await check(true)
    if (info?.available) console.info(`[gift-book] 发现新版本 ${info.version}`)
  }, 6 * 60 * 60 * 1000)
}

function panelHtml(info) {
  const current = escapeHtml(String(info?.current || APP_VERSION))
  let body = `<div class="update-panel">
    <div class="update-current">当前版本 <b>v${current}</b></div>`
  if (info?.error) {
    body += `<p class="update-error">检查失败：${escapeHtml(info.error)}</p>`
  } else if (info?.available === false) {
    body += `<p class="update-ok">已是最新版本。</p>`
  } else if (info?.reason === 'unsupported') {
    body += `<p class="update-hint">当前部署方式不支持容器内自更新。</p>`
  } else if (info?.available) {
    body += `<div class="update-new">
      <div>发现新版本 <b>v${escapeHtml(info.version)}</b></div>
      <div class="update-meta">架构 ${escapeHtml(info.arch || '')} · 大小 ${Math.round((info.size || 0) / 1024)} KB</div>
    </div>`
  } else {
    body += `<p class="update-hint">点「检查更新」查看是否有新版本。</p>`
  }
  body += `<div class="update-proxy">
    <label for="update-proxy-input">代理地址（可选）</label>
    <div class="update-proxy-row">
      <input id="update-proxy-input" type="text" inputmode="url" placeholder="http://10.10.10.254:7890" value="${escapeHtml(String(info?.proxy || ''))}" />
      <button type="button" id="update-proxy-save" class="modal-btn-ghost">保存</button>
    </div>
    <p class="update-hint">仅更新检查与下载走此代理；留空表示直连。</p>
  </div>`
  body += `<div class="update-actions">
    <button type="button" id="update-check-btn" class="modal-btn-ghost">检查更新</button>`
  if (info?.available) {
    body += `<button type="button" id="update-apply-btn" class="modal-btn-primary">立即更新并重启</button>`
  }
  body += `</div></div>`
  return body
}

export async function showAppUpdate() {
  let info = await check()
  const render = () => {
    openModal('程序更新', { type: 'html', html: panelHtml(info) }, [
      { text: '关闭', class: 'modal-btn-ghost' },
    ], { dismissable: true })
    document.getElementById('update-check-btn')?.addEventListener('click', async () => {
      info = await check(true)
      render()
    })
    document.getElementById('update-proxy-save')?.addEventListener('click', async () => {
      const input = document.getElementById('update-proxy-input')
      const proxy = String(input?.value || '').trim()
      const btn = document.getElementById('update-proxy-save')
      if (btn) { btn.disabled = true; btn.textContent = '保存中…' }
      try {
        const res = await apiRequest('/api/update/settings', 'PUT', { proxy })
        info = { ...(info || {}), proxy: res?.data?.proxy || '' }
        cached = null
        render()
      } catch (err) {
        info = { ...(info || {}), error: err?.message || '代理保存失败' }
        render()
      }
    })
    document.getElementById('update-apply-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('update-apply-btn')
      if (btn) { btn.disabled = true; btn.textContent = '正在更新…' }
      try {
        const res = await apiRequest('/api/update/apply', 'POST', { tag: info.tag, version: info.version })
        closeModal()
        openModal('更新完成', { type: 'html', html: `<div class="update-panel">
          <p class="update-ok">已安装 v${escapeHtml(res?.data?.version || info.version)}。</p>
          <p class="update-hint">${res?.data?.restart ? '程序正在重启，几秒后刷新页面即可。' : '请手动重启程序使更新生效。'}</p>
        </div>` }, [{ text: '知道了', class: 'modal-btn-primary' }], { dismissable: false })
        if (res?.data?.restart) {
          setTimeout(() => window.location.reload(), 8000)
        }
      } catch (err) {
        info = { ...info, error: err?.message || '安装失败' }
        render()
      }
    })
  }
  render()
}

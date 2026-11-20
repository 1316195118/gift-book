// 容器内自更新的前端入口：在「本机与关于 → 程序更新」里检查并安装新版本。
// 检查只读；安装由服务端再做一次管理员校验，下载与落盘改成后台任务后轮询进度。
import { apiRequest } from './api.js'
import { afterModalRender, modal, openModal } from './modal.js'
import { escapeHtml } from './ledger-actions.js'
import { APP_VERSION } from './changelog.js'

let lastCheck = 0
let cached = null
let reloadTimer = null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

async function readProgress() {
  try {
    const res = await apiRequest('/api/update/progress')
    return res?.data || null
  } catch {
    return null
  }
}

// 后台自检：每 6 小时一次，只记录结果，不打扰用户；有更新时在设置里给提示。
let autoTimer = null
export function startAutoCheck() {
  if (autoTimer) return
  autoTimer = setInterval(async () => {
    const info = await check(true)
    if (info?.available) console.info(`[gift-book] 发现新版本 ${info.version}`)
  }, 6 * 60 * 60 * 1000)
}

export function updateSizeLabel(raw) {
  const bytes = Math.max(0, Number(raw) || 0)
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function percentOf(job) {
  return Math.max(0, Math.min(100, Math.round(Number(job?.percent) || 0)))
}

export function updateVersionLabel(raw) {
  return String(raw || '').trim().replace(/^v/i, '')
}

function progressMarkup(info) {
  const job = info?.job || null
  const checking = Boolean(info?.checking)
  const indeterminate = checking && !job
  const percent = job ? percentOf(job) : 0
  const width = indeterminate ? 42 : percent
  const message = escapeHtml(job?.message || (checking ? '正在连接更新服务并检查版本…' : '正在准备更新…'))
  const bytes =
    job?.stage === 'downloading' && job.total > 0
      ? `已下载 ${escapeHtml(updateSizeLabel(job.downloaded))} / ${escapeHtml(updateSizeLabel(job.total))}`
      : job?.state === 'succeeded'
        ? '安装和校验已完成'
        : '请保持页面打开，更新会自动继续'
  const ariaNow = indeterminate ? '' : ` aria-valuenow="${percent}"`
  return `<div class="update-feedback${indeterminate ? ' is-indeterminate' : ''}" id="update-feedback" role="status" aria-live="polite">
    <div class="update-feedback-head">
      <span id="update-feedback-text">${message}</span>
      <b id="update-progress-percent">${indeterminate ? '' : `${percent}%`}</b>
    </div>
    <div class="update-progress" id="update-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"${ariaNow}>
      <span id="update-progress-bar" style="width:${width}%"></span>
    </div>
    <div class="update-feedback-meta" id="update-progress-meta">${bytes}</div>
  </div>`
}

function conclusionMarkup(info) {
  const current = escapeHtml(updateVersionLabel(info?.current || info?.job?.current || APP_VERSION))
  const job = info?.job
  if (job?.state === 'running') {
    return `<div class="update-new">
      <div class="update-new-title">正在更新到 <b>v${escapeHtml(updateVersionLabel(job.version) || '新版本')}</b></div>
      <div class="update-meta">当前 v${current} · 完成后会自动重启</div>
    </div>`
  }
  if (job?.state === 'failed') {
    return `<p class="update-error">更新失败：${escapeHtml(job.error || job.message || '未知错误')}</p>`
  }
  if (job?.state === 'succeeded') {
    return `<p class="update-ok">已安装 v${escapeHtml(updateVersionLabel(job.version) || '新版本')}</p>
      <p class="update-hint">${job.restart ? '程序正在重启，页面会在几秒后自动刷新。' : '请手动重启程序使更新生效。'}</p>`
  }
  if (info?.checking) {
    return `<div class="update-new"><div class="update-new-title">正在检查更新</div>
      <div class="update-meta">正在读取发布版本，网络较慢时可能需要几十秒</div></div>`
  }
  if (info?.error) {
    return `<p class="update-error">检查失败：${escapeHtml(info.error)}</p>`
  }
  if (info?.reason === 'unsupported') {
    return `<p class="update-hint">当前部署方式不支持容器内自更新。</p>`
  }
  if (info?.available) {
    return `<div class="update-new">
      <div class="update-new-title">发现新版本 <b>v${escapeHtml(updateVersionLabel(info.version))}</b></div>
      <div class="update-meta">当前 v${current} · ${escapeHtml(info.arch || '')} · ${escapeHtml(updateSizeLabel(info.size))}</div>
    </div>`
  }
  if (info?.available === false) return `<p class="update-ok">已是最新版本</p>`
  return `<p class="update-hint">点「检查更新」查看是否有新版本。</p>`
}

function panelHtml(info) {
  const current = escapeHtml(updateVersionLabel(info?.current || info?.job?.current || APP_VERSION))
  const job = info?.job
  const running = job?.state === 'running' || info?.checking
  const finished = job?.state === 'succeeded'
  const failed = job?.state === 'failed'
  const showProgress = info?.checking || running || finished
  let body = `<div class="update-panel">`
  body += conclusionMarkup(info)
  if (showProgress) body += progressMarkup(info)
  if (info?.available && !running && !finished && !failed) {
    body += `<div class="update-current">当前版本 <b>v${current}</b></div>`
  }
  if (!running && !finished) {
    body += `<div class="update-proxy">
      <label for="update-proxy-input">代理地址（可选）</label>
      <div class="update-proxy-row">
        <input id="update-proxy-input" type="text" inputmode="url" placeholder="http://127.0.0.1:7890" value="${escapeHtml(String(info?.proxy || ''))}" />
        <button type="button" id="update-proxy-save" class="modal-btn-ghost">保存</button>
      </div>
      <p class="update-hint">仅更新检查与下载走此代理；留空表示直连。</p>
    </div>`
  }
  body += `<div class="update-actions">
    <button type="button" id="update-check-btn" class="modal-btn-ghost"${running ? ' disabled' : ''}>${info?.checking ? '正在检查…' : '检查更新'}</button>`
  if ((info?.available || failed) && !running && !finished) {
    body += `<button type="button" id="update-apply-btn" class="modal-btn-primary">${failed ? '重试更新并重启' : '立即更新并重启'}</button>`
  }
  body += `</div>`
  if (info?.available && !running && !finished) {
    body += `<p class="update-hint">更新会下载约 ${Math.max(1, Math.round((info.size || 0) / 1024 / 1024))} MB，装完自动重启，期间约 10 秒无法访问。</p>`
  }
  body += `</div>`
  return body
}

function isCurrent(token) {
  return modal.open && modal.title === '程序更新' && modal.token === token
}

function paintProgress(job) {
  const panel = document.getElementById('update-feedback')
  if (!panel || !job || job.state !== 'running') return
  const percent = percentOf(job)
  panel.classList.remove('is-indeterminate')
  const text = document.getElementById('update-feedback-text')
  const value = document.getElementById('update-progress-percent')
  const bar = document.getElementById('update-progress-bar')
  const track = document.getElementById('update-progress')
  const meta = document.getElementById('update-progress-meta')
  if (text) text.textContent = job.message || '正在更新…'
  if (value) value.textContent = `${percent}%`
  if (bar) bar.style.width = `${percent}%`
  if (track) track.setAttribute('aria-valuenow', String(percent))
  if (meta) {
    meta.textContent =
      job.stage === 'downloading' && job.total > 0
        ? `已下载 ${updateSizeLabel(job.downloaded)} / ${updateSizeLabel(job.total)}`
        : '请保持页面打开，更新会自动继续'
  }
}

async function pollUpdateJob(token, info) {
  let failures = 0
  while (isCurrent(token)) {
    const job = await readProgress()
    if (!job) {
      failures += 1
      if (failures >= 3) {
        render({ ...info, job: null, error: '暂时无法读取更新进度，请重新打开程序更新查看结果' })
        break
      }
    } else {
      failures = 0
      if (job.state === 'idle') break
      if (job.state === 'running') {
        paintProgress(job)
      } else {
        render({ ...info, checking: false, job, current: job.current || info.current })
        if (job.state === 'succeeded' && job.restart && !reloadTimer) {
          reloadTimer = setTimeout(() => window.location.reload(), 8000)
        }
        break
      }
    }
    await sleep(650)
  }
}

function render(info) {
  const token = openModal(
    '程序更新',
    { type: 'html', html: panelHtml(info) },
    [{ text: '关闭', class: 'modal-btn-ghost' }],
    { dismissable: true },
  )
  afterModalRender(() => {
    if (isCurrent(token)) bind(token, info)
  })
  return token
}

async function runCheck(token, info) {
  if (!isCurrent(token)) return
  const checkingToken = render({ ...info, checking: true, error: '', job: null })
  const next = await check(true)
  if (isCurrent(checkingToken)) render({ ...next, checking: false })
}

async function applyUpdate(token, info) {
  if (!isCurrent(token)) return
  const pending = {
    ...info,
    checking: false,
    error: '',
    job: {
      state: 'running',
      version: info.version,
      current: info.current || APP_VERSION,
      stage: 'connecting',
      message: '正在提交更新请求…',
      percent: 1,
    },
  }
  const pendingToken = render(pending)
  try {
    const res = await apiRequest('/api/update/apply', 'POST', { tag: info.tag, version: info.version })
    if (!isCurrent(pendingToken)) return
    const job = res?.data || pending.job
    const nextToken = render({ ...info, job })
    if (job.state === 'running') await pollUpdateJob(nextToken, { ...info, job })
  } catch (err) {
    if (!isCurrent(pendingToken)) return
    render({ ...info, error: err?.message || '安装失败' })
  }
}

function bind(token, info) {
  document.getElementById('update-check-btn')?.addEventListener('click', () => runCheck(token, info))
  document.getElementById('update-apply-btn')?.addEventListener('click', () => applyUpdate(token, info))
  document.getElementById('update-proxy-save')?.addEventListener('click', async () => {
    const input = document.getElementById('update-proxy-input')
    const proxy = String(input?.value || '').trim()
    const btn = document.getElementById('update-proxy-save')
    if (btn) {
      btn.disabled = true
      btn.textContent = '保存中…'
    }
    try {
      const res = await apiRequest('/api/update/settings', 'PUT', { proxy })
      cached = null
      if (isCurrent(token)) render({ ...info, proxy: res?.data?.proxy || '', error: '' })
    } catch (err) {
      if (isCurrent(token)) render({ ...info, error: err?.message || '代理保存失败' })
    }
  })
}

export async function showAppUpdate() {
  const initial = { current: APP_VERSION, proxy: '', checking: true }
  const token = render(initial)
  const progress = await readProgress()
  if (!isCurrent(token)) return
  if (progress?.state === 'running') {
    const nextToken = render({ current: progress.current || APP_VERSION, proxy: '', job: progress })
    await pollUpdateJob(nextToken, { current: progress.current || APP_VERSION, job: progress })
    return
  }
  const result = await check()
  if (!isCurrent(token)) return
  const latestProgress = await readProgress()
  if (!isCurrent(token)) return
  if (latestProgress?.state === 'running') {
    const nextToken = render({ ...result, job: latestProgress, checking: false })
    await pollUpdateJob(nextToken, { ...result, job: latestProgress, checking: false })
    return
  }
  render({ ...result, checking: false, job: latestProgress?.state === 'idle' ? null : latestProgress })
}

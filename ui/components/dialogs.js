// 弹窗内嵌面板：访问保护 / 网络状态 / 自动备份（原生 JS，零第三方依赖）。
import { state as st, subscribe } from '../store.js'
import { api } from '../lib/api.js'
import { closeModal, openModal, alert as showAlert } from '../lib/modal.js'
import { NET_TARGETS, statsFor, computeHealth, refreshNetwork } from '../lib/network.js'
import { verifyLedgerPassword } from '../lib/actions.js'
import { endSession, loadEvents, showHome } from '../bootstrap.js'
import { escapeHtml } from '../lib/crypto.js'

// ---- 访问保护 ----
export const AccessPanel = {
  render(props = {}) {
    const enabled = Boolean(props.enabled)
    const showCurrent = enabled
    const showToken = !enabled && st.authSetupRequired
    return `
      <div class="access-body">
        <label class="access-switch-row" for="access-toggle">
          <span><b>进入礼簿需要访问密码</b><small>关闭后本机直接进入；开启后每次打开需验证，登录状态保留 7 天。</small></span>
          <input type="checkbox" id="access-toggle" ${enabled ? 'checked' : ''} />
        </label>
        <div class="access-fields">
          <div class="field" ${showCurrent ? '' : 'style="display:none"'}>
            <label for="access-current" class="field-label">当前密码</label>
            <input type="password" id="access-current" placeholder="关闭或修改密码时填写" autocomplete="current-password" />
          </div>
          <div class="field">
            <label for="access-new" class="field-label">${enabled ? '新密码（留空则不修改）' : '设置访问密码'} <span class="opt">至少 8 位</span></label>
            <input type="password" id="access-new" placeholder="${enabled ? '留空保持当前密码' : '至少 8 位'}" autocomplete="new-password" />
          </div>
          <div class="field">
            <label for="access-confirm" class="field-label">确认新密码</label>
            <input type="password" id="access-confirm" placeholder="再次输入" autocomplete="new-password" />
          </div>
          <div class="field" ${showToken ? '' : 'style="display:none"'}>
            <label for="access-setup-token" class="field-label">设置口令 <span class="opt">部署时配置</span></label>
            <input type="password" id="access-setup-token" placeholder="开启访问保护需要此口令" autocomplete="new-password" />
          </div>
        </div>
        <div class="access-error hidden" id="access-error" role="alert"></div>
        <p class="access-tip">访问保护与单本账簿的管理密码相互独立。开启后请把密码记在安全的地方。</p>
        <div class="dialog-actions">
          <button type="button" class="modal-btn-ghost" id="access-cancel">取消</button>
          <button type="button" class="modal-btn-primary" id="access-save">保存</button>
        </div>
      </div>`
  },
  mount(root, props = {}) {
    const initialEnabled = Boolean(props.enabled)
    const setError = (msg) => {
      const el = root.querySelector('#access-error')
      if (!el) return
      el.textContent = msg || ''
      el.classList.toggle('hidden', !msg)
    }
    const save = async () => {
      setError('')
      const enabled = root.querySelector('#access-toggle').checked
      const current = root.querySelector('#access-current').value
      const next = root.querySelector('#access-new').value
      const confirm = root.querySelector('#access-confirm').value
      const setupToken = root.querySelector('#access-setup-token').value
      const saveBtn = root.querySelector('#access-save')
      if (enabled) {
        if (!initialEnabled && !next) return setError('请设置访问密码')
        if (!initialEnabled && st.authSetupRequired && !setupToken) return setError('请输入设置口令')
        if (next && next.length < 8) return setError('访问密码至少 8 位')
        if (next !== confirm) return setError('两次输入的密码不一致')
        saveBtn.disabled = true
        try {
          const payload = { enabled: true }
          if (next) payload.password = next
          if (initialEnabled && current) payload.currentPassword = current
          if (!initialEnabled && st.authSetupRequired) payload.setupToken = setupToken
          await api.updateAuth(payload)
          st.authEnabled = true
          closeModal()
          showAlert('已开启', next ? '访问密码已保存。' : '设置已保存。')
        } catch (err) {
          setError(err.message || '保存失败')
        } finally {
          saveBtn.disabled = false
        }
        return
      }
      if (initialEnabled && !current) return setError('请输入当前访问密码')
      saveBtn.disabled = true
      try {
        await api.updateAuth({ enabled: false, currentPassword: current })
        st.authEnabled = false
        closeModal()
        showAlert('已关闭', '本机将直接进入礼簿。')
      } catch (err) {
        setError(err.message || '保存失败')
      } finally {
        saveBtn.disabled = false
      }
    }
    root.querySelector('#access-cancel').addEventListener('click', () => closeModal())
    root.querySelector('#access-save').addEventListener('click', save)
  },
}

// ---- 网络状态 ----
export const NetworkPanel = {
  render() {
    return `
      <div class="network-panel">
        <p class="hint" style="margin-bottom:10px">当前：<span id="np-health">检测中</span>（近 12 次采样）</p>
        <table class="net-detail-table">
          <thead><tr><th>链路</th><th class="num">中位延迟</th><th class="num">最小 / 最大</th><th class="num">可用率</th></tr></thead>
          <tbody id="np-rows"></tbody>
        </table>
        <p class="net-detail-note">账簿接口与登录状态走本地 Go 服务，静态资源走内嵌文件；每 15 秒自动刷新一次。延迟 &lt;120ms 为通畅，120–400ms 偏慢，超过 400ms 或不可用标红。</p>
        <div class="dialog-actions">
          <button type="button" class="modal-btn-ghost" id="np-retest" :disabled="busy">立即重测</button>
          <button type="button" class="modal-btn-primary" id="np-close">知道了</button>
        </div>
      </div>`
  },
  mount(root) {
    const rowsEl = root.querySelector('#np-rows')
    const healthEl = root.querySelector('#np-health')
    const retestBtn = root.querySelector('#np-retest')
    const update = () => {
      rowsEl.innerHTML = NET_TARGETS.map((t) => {
        const s = statsFor(t.key)
        const color = s.ok ? (s.avg <= 120 ? '#4f9d68' : s.avg <= 400 ? '#d39a34' : '#c0392b') : '#c0392b'
        const value = s.ok ? `${s.avg} ms` : '不可用'
        const range = s.ok ? `${s.min} / ${s.max}` : '-'
        const rate = s.ok ? `${s.rate}%` : '0%'
        return `<tr><td><span class="net-dot" style="display:inline-block;margin-right:8px;background:${color}"></span>${t.label}</td><td class="num">${value}</td><td class="num">${range}</td><td class="num">${rate}</td></tr>`
      }).join('')
      const h = computeHealth()
      healthEl.textContent = h.level === 'good' ? '通畅' : h.level === 'warn' ? '偏慢' : '异常'
    }
    update()
    this._unsub = subscribe(update)
    retestBtn.addEventListener('click', async () => {
      retestBtn.disabled = true
      retestBtn.textContent = '重测中…'
      try {
        await refreshNetwork()
      } finally {
        retestBtn.disabled = false
        retestBtn.textContent = '立即重测'
      }
    })
    root.querySelector('#np-close').addEventListener('click', () => closeModal())
  },
  destroy() {
    if (this._unsub) this._unsub()
  },
}

// ---- 自动备份 ----
const AUTO_INTERVALS = [
  { value: 1, label: '每小时' },
  { value: 6, label: '每 6 小时' },
  { value: 12, label: '每 12 小时' },
  { value: 24, label: '每天' },
  { value: 168, label: '每周' },
]

export const AutoBackupPanel = {
  render() {
    return `
      <div class="autobackup-body">
        <label class="access-switch-row" for="auto-toggle">
          <span><b>定时自动备份</b><small>按设定间隔把所有账簿打包，存到服务器数据目录的 backups/ 下。备份内容与账簿导出相同，只有密文。</small></span>
          <input type="checkbox" id="auto-toggle" />
        </label>
        <div class="field">
          <label class="field-label">备份频率</label>
          <div class="option-chips" id="auto-intervals"></div>
        </div>
        <div class="field">
          <label class="field-label" for="auto-keep">保留份数 <span class="opt">最近 <span id="auto-keep-n">14</span> 份，更早的自动清理</span></label>
          <input id="auto-keep" type="number" min="1" max="200" step="1" inputmode="numeric" />
        </div>
        <div class="autobackup-actions">
          <button type="button" class="themed-button-secondary" id="auto-run">立即备份全部账簿</button>
          <button type="button" class="themed-button-secondary" id="auto-upload">上传备份文件</button>
          <input type="file" id="auto-file" accept=".zip,application/zip" class="ocr-file-input" style="display:none" />
        </div>
        <p class="field-hint">备份只包含加密后的礼金内容；别人拿到文件也打不开，需要对应账簿的管理密码。</p>
        <div class="autobackup-status">
          <div><span>上次备份</span><b id="auto-last">尚未备份</b></div>
          <div><span>存放位置</span><code id="auto-dir"></code></div>
        </div>
        <div id="auto-files"></div>
        <div class="access-error hidden" id="auto-error" role="alert"></div>
        <div class="field-hint autobackup-ok hidden" id="auto-message"></div>
        <div class="dialog-actions">
          <button type="button" class="modal-btn-ghost" id="auto-close">关闭</button>
          <button type="button" class="modal-btn-primary" id="auto-save">保存设置</button>
        </div>
      </div>`
  },
  mount(root) {
    const $ = (id) => root.querySelector(id)
    const state = { enabled: false, interval: 24, keep: 14, lastBackupAt: '', dir: '', files: [], error: '', message: '', busy: false, saving: false }

    const sizeText = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
    const timeText = (value) => (value ? new Date(value).toLocaleString('zh-CN') : '')

    const renderIntervals = () => {
      $('#auto-intervals').innerHTML = AUTO_INTERVALS.map(
        (o) => `<button type="button" class="option-chip ${state.interval === o.value ? 'active' : ''}" data-interval="${o.value}">${o.label}</button>`,
      ).join('')
      $('#auto-intervals').querySelectorAll('.option-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.interval = Number(btn.dataset.interval)
          renderIntervals()
        })
      })
    }
    const renderFiles = () => {
      if (!state.files.length) {
        $('#auto-files').innerHTML = '<p class="field-hint">还没有备份文件。开启定时备份或点「立即备份全部账簿」生成一份。</p>'
        return
      }
      $('#auto-files').innerHTML = `
        <div class="autobackup-files">
          <div class="autobackup-files-head">已有备份</div>
          <ul>${state.files
            .map(
              (f) => `<li><div class="autobackup-file-info"><span class="autobackup-file-name">${escapeHtml(f.name)}</span><span class="autobackup-file-meta">${sizeText(f.size)} · ${timeText(f.modTime)}</span></div><div class="autobackup-file-actions"><button type="button" class="autobackup-mini" data-restore="${encodeURIComponent(f.name)}">还原</button><a class="autobackup-mini" href="/api/autobackup/file/${encodeURIComponent(f.name)}">下载</a><button type="button" class="autobackup-mini is-danger" data-delete="${encodeURIComponent(f.name)}">删除</button></div></li>`,
            )
            .join('')}</ul>
        </div>`
      $('#auto-files').querySelectorAll('[data-restore]').forEach((b) =>
        b.addEventListener('click', () => askRestore(decodeURIComponent(b.dataset.restore))),
      )
      $('#auto-files').querySelectorAll('[data-delete]').forEach((b) =>
        b.addEventListener('click', () => askDelete(decodeURIComponent(b.dataset.delete))),
      )
    }
    const setError = (msg) => {
      state.error = msg || ''
      const el = $('#auto-error')
      el.textContent = state.error
      el.classList.toggle('hidden', !state.error)
    }
    const setMessage = (msg) => {
      state.message = msg || ''
      const el = $('#auto-message')
      el.textContent = state.message
      el.classList.toggle('hidden', !state.message)
    }

    const load = async () => {
      try {
        const result = await api.autobackupGet()
        const data = result.data || {}
        state.enabled = Boolean(data.enabled)
        state.interval = Number(data.intervalHours) || 24
        state.keep = Number(data.keep) || 14
        state.lastBackupAt = data.lastBackupAt || ''
        state.dir = data.dir || ''
        state.files = Array.isArray(data.files) ? data.files : []
        state.error = data.lastError || ''
      } catch (err) {
        setError(err.message || '读取备份设置失败')
      }
      $('#auto-toggle').checked = state.enabled
      $('#auto-keep').value = state.keep
      $('#auto-keep-n').textContent = state.keep
      $('#auto-last').textContent = state.lastBackupAt || '尚未备份'
      $('#auto-dir').textContent = state.dir
      renderIntervals()
      renderFiles()
      setError(state.error)
    }

    const save = async () => {
      if (state.saving) return
      state.saving = true
      setError('')
      try {
        await api.autobackupSave({ enabled: state.enabled, intervalHours: state.interval, keep: state.keep })
        await load()
        setMessage('设置已保存')
      } catch (err) {
        setError(err.message || '保存失败')
      } finally {
        state.saving = false
      }
    }
    const runNow = async () => {
      if (state.busy) return
      state.busy = true
      setError('')
      setMessage('')
      try {
        await api.autobackupRun()
        await load()
        setMessage('已生成一份备份，包含全部账簿')
      } catch (err) {
        setError(err.message || '备份失败')
      } finally {
        state.busy = false
      }
    }

    const confirmRestore = (label) =>
      new Promise((resolve) => {
        const needPassword = Boolean(st.authEnabled)
        const body = `
          <div class="restore-confirm">
            <p><strong>即将用「${escapeHtml(label)}」覆盖当前全部账簿。</strong></p>
            <p class="confirm-note">现有数据会先移入数据目录的 .trash，确认无误后可手动删除。</p>
            <p class="confirm-note is-warning">此操作无法在页面中撤销。</p>
            ${
              needPassword
                ? '<label class="field-label" for="restore-pwd">请输入访问密码以继续</label><input id="restore-pwd" type="password" autocomplete="current-password" placeholder="访问密码" />'
                : '<label class="field-label" for="restore-text">请输入「还原」两个字以继续</label><input id="restore-text" type="text" placeholder="还原" autocomplete="off" />'
            }
            <div class="access-error hidden" id="restore-error" role="alert"></div>
          </div>`
        openModal('确认还原', { type: 'html', html: body }, [
          { text: '取消', class: 'modal-btn-ghost', keepOpen: true, handler: () => { resolve(false); closeModal() } },
          {
            text: '确认还原',
            class: 'modal-btn-danger',
            keepOpen: true,
            handler: async () => {
              const fail = (msg) => {
                const el = document.getElementById('restore-error')
                if (el) { el.textContent = msg; el.classList.remove('hidden') }
              }
              if (needPassword) {
                const pwd = document.getElementById('restore-pwd')?.value || ''
                if (!pwd) return fail('请输入访问密码')
                try { await api.login(pwd) } catch (err) { return fail(err.message || '访问密码不正确') }
              } else {
                const text = (document.getElementById('restore-text')?.value || '').trim()
                if (text !== '还原') return fail('请输入「还原」两个字')
              }
              resolve(true)
              closeModal()
            },
          },
        ])
      })

    const askRestore = async (name) => {
      if (!(await confirmRestore(name))) return
      state.busy = true
      setError('')
      try {
        const result = await api.autobackupRestore(name)
        setMessage(`已还原 ${result.data?.events ?? 0} 本账簿、${result.data?.gifts ?? 0} 条礼金记录`)
        endSession()
        await loadEvents()
        showHome()
      } catch (err) {
        setError(err.message || '还原失败')
      } finally {
        state.busy = false
      }
    }
    const restoreFromFile = async (file) => {
      if (!(await confirmRestore(file.name))) return
      state.busy = true
      setError('')
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/backup/restore', { method: 'POST', body: form, credentials: 'same-origin' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.success) throw new Error(data.message || '还原失败')
        setMessage(`已还原 ${data.data?.events ?? 0} 本账簿、${data.data?.gifts ?? 0} 条礼金记录`)
        endSession()
        await loadEvents()
        showHome()
      } catch (err) {
        setError(err.message || '还原失败')
      } finally {
        state.busy = false
      }
    }
    const askDelete = async (name) => {
      const ok = await new Promise((resolve) => {
        openModal('删除备份', { type: 'html', html: `<p>确定删除备份「${escapeHtml(name)}」吗？</p><p class="confirm-note">删除后无法恢复，但其他备份不受影响。</p>` }, [
          { text: '取消', class: 'modal-btn-ghost', handler: () => resolve(false) },
          { text: '删除', class: 'modal-btn-danger', handler: () => resolve(true) },
        ])
      })
      if (!ok) return
      try {
        await api.autobackupDelete(name)
        await load()
        setMessage('备份已删除')
      } catch (err) {
        setError(err.message || '删除失败')
      }
    }

    $('#auto-toggle').addEventListener('change', (e) => { state.enabled = e.target.checked })
    $('#auto-keep').addEventListener('input', (e) => {
      state.keep = Number(e.target.value) || 1
      $('#auto-keep-n').textContent = state.keep
    })
    $('#auto-run').addEventListener('click', runNow)
    $('#auto-upload').addEventListener('click', () => $('#auto-file').click())
    $('#auto-file').addEventListener('change', (e) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (file) restoreFromFile(file)
    })
    $('#auto-close').addEventListener('click', () => closeModal())
    $('#auto-save').addEventListener('click', save)

    load()
  },
}

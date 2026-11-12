// 备份与迁移：整站导出 zip、导入恢复、查看数据目录概况。
import { state as st } from '../store.js'
import { api, ApiError } from './api.js'
import { openModal, closeModal, alert as showAlert, afterModalRender } from './modal.js'
import { notify } from './notify.js'
import { loadEvents, showHome, endSession } from '../bootstrap.js'
import { escapeHtml } from './crypto.js'

let infoCache = null

export async function openBackupDialog() {
  let info = { events: 0, gifts: 0, dir: '—', build: st.build || '—', authOn: st.authEnabled }
  try {
    const result = await api.backupInfo()
    info = { ...info, ...result.data }
    infoCache = info
  } catch (error) {
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') return
  }
  const html = `
    <div class="backup-body">
      <p class="backup-lead">当前共有 <b>${info.events}</b> 本账簿、<b>${info.gifts}</b> 条礼金记录。</p>
      <div class="backup-actions">
        <button type="button" class="backup-action" data-action="export">
          <b>导出整站备份</b>
          <small>下载 zip：全部账簿 + 礼金密文 + 访问保护设置</small>
        </button>
        <label class="backup-action backup-action-import">
          <b>导入备份并恢复</b>
          <small>选择之前导出的 zip，覆盖当前数据（原数据会移入 .trash）</small>
          <input type="file" id="backup-file" accept=".zip,application/zip" hidden />
        </label>
      </div>
      <p class="backup-note">数据目录：<code>${escapeHtml(info.dir)}</code></p>
      <p class="backup-note">礼金在服务器上只保存密文；换机器时把 data 目录一并拷走，或使用上面的备份包迁移即可。</p>
      <div class="access-error hidden" id="backup-error" role="alert"></div>
    </div>`
  openModal('数据备份与迁移', { type: 'html', html }, [{ text: '关闭', class: 'modal-btn-ghost' }])
  afterModalRender(() => {
    document.querySelector('[data-action="export"]')?.addEventListener('click', () => {
      window.location.href = '/api/backup'
    })
    document.getElementById('backup-file')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      await importBackup(file)
    })
  })

}

async function importBackup(file) {
  const error = document.getElementById('backup-error')
  const fail = (message) => {
    if (!error) return
    error.textContent = message
    error.classList.remove('hidden')
  }
  if (!file.name.toLowerCase().endsWith('.zip')) return fail('请选择导出的 .zip 备份包')
  fail('')
  error?.classList.add('hidden')
  openModal(
    '导入备份',
    {
      type: 'html',
      html: `<p>即将用 <b>${escapeHtml(file.name)}</b> 覆盖当前全部账簿数据。</p><p class="text-sm text-gray-600 mt-2">现有数据会先移动到数据目录的 <code>.trash/import-时间/</code>，确认无误后可手动删除。</p><p class="text-sm text-red-600 mt-2">此操作不可在页面中撤销，请确认当前数据已备份。</p>`,
    },
    [
      { text: '取消', class: 'modal-btn-ghost' },
      {
        text: '确认导入',
        class: 'modal-btn-danger',
        handler: async () => {
          const form = new FormData()
          form.append('file', file)
          try {
            const res = await fetch('/api/backup/restore', { method: 'POST', body: form, credentials: 'same-origin' })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data.success) throw new Error(data.message || '导入失败')
            endSession()
            await loadEvents()
            showHome()
            notify.success('导入完成', `已恢复 ${data.data?.events ?? 0} 本账簿、${data.data?.gifts ?? 0} 条礼金记录。`)
          } catch (err) {
            fail(err.message || '导入失败，请重试')
          }
        },
      },
    ],
  )
}

export { infoCache }

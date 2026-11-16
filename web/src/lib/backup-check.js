// 备份包体检：上传后只解析校验，不写任何数据，让用户在还原前先确认包是好的。
import { openModal } from './modal.js'
import { escapeHtml } from './crypto.js'

export async function checkBackupFile(path, file) {
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok || !payload.success) throw new Error(payload.message || '检查失败，请重新选择备份文件')
  return payload.data || {}
}

export async function showBackupCheck(path, file) {
  const data = await checkBackupFile(path, file)
  const mismatch = data.matches === false
  const scope = data.scope === 'family'
    ? `家庭「${escapeHtml(data.familyName || '未命名')}」`
    : '整站备份（含全部家庭）'
  const html = `
    <div class="gb-backup-check">
      <p class="gb-check-title">${mismatch ? '包是完整的，但它属于其他家庭。' : '备份包完整，可以还原。'}</p>
      <div class="gb-check-grid">
        <span>来源</span><b>${scope}</b>
        <span>创建时间</span><b>${escapeHtml(data.createdAt || '—')}</b>
        <span>内容</span><b>${Number(data.events) || 0} 本账簿 · ${Number(data.gifts) || 0} 条礼金</b>
        <span>校验</span><b>${data.checksummed ? '逐文件 sha256 校验通过' : '旧格式，未带校验和'}</b>
        <span>文件</span><b>${escapeHtml(data.sourceName || file.name)}</b>
      </div>
      ${mismatch
        ? '<p class="gb-inline-error">这份备份属于其他家庭，不能在本家庭还原；请到对应家庭操作。</p>'
        : '<p class="gb-picker-hint">检查只读取文件，不会改动现有账簿。</p>'}
    </div>`
  openModal('备份包检查', { type: 'html', html }, [{ text: '关闭', class: 'modal-btn-ghost' }], { dismissable: true })
}

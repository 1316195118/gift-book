// 批量导入：CSV 名单 → 解析预览 → 逐行加密入队并提交（复用离线队列，弱网自动补传）。
import { state as st, touchSession } from '../store.js'
import { openModal, closeModal, afterModalRender, alert as showAlert } from './modal.js'
import { escapeHtml, newRequestId, formatCurrency } from './crypto.js'
import { encryptData, loadGiftsForCurrentEvent } from '../bootstrap.js'
import { enqueueGift, removeQueued, readQueue, writeQueue } from './offline.js'
import { api, ApiError } from './api.js'
import { paintQueueCount } from './queue-count.js'

const MAX_NAME = 20
const MAX_AMOUNT = 1000000
const MIN_AMOUNT = 0.01
const PAYMENT_TYPES = ['现金', '支付宝', '微信', '其他']

let pending = { records: [], errors: [], fileName: '' }

// 解析 CSV：支持 UTF-8 BOM、双引号包裹、"" 转义、CRLF。
export function parseCsv(text) {
  const s = String(text == null ? '' : text).replace(/^\ufeff/, '')
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''))
}

// 按表头（若有）或列序把行映射为礼金记录，并收集错误行。
export function mapRows(rows) {
  if (!rows.length) return { records: [], errors: [] }
  const header = rows[0].map((c) => String(c).trim())
  const hasHeader = header.some((h) => /姓名|名字|金额|礼金|备注|关系|方式|说明/.test(h))
  const idx = { name: 0, amount: 1, type: 2, relation: 3, remarks: 4 }
  if (hasHeader) {
    header.forEach((h, i) => {
      if (/姓名|名字/.test(h)) idx.name = i
      else if (/金额|礼金|钱/.test(h)) idx.amount = i
      else if (/收款|方式|类型/.test(h)) idx.type = i
      else if (/关系|类别|分组/.test(h)) idx.relation = i
      else if (/备注|说明/.test(h)) idx.remarks = i
    })
  }
  const records = []
  const errors = []
  const dataRows = hasHeader ? rows.slice(1) : rows
  dataRows.forEach((r, i) => {
    const lineNo = hasHeader ? i + 2 : i + 1
    const name = String(r[idx.name] ?? '').trim()
    const amountRaw = String(r[idx.amount] ?? '').replace(/[¥￥,\s]/g, '')
    const amount = Number(amountRaw)
    const typeRaw = String(r[idx.type] ?? '').trim()
    const relation = String(r[idx.relation] ?? '').trim()
    const remarks = String(r[idx.remarks] ?? '').trim()
    if (!name || Array.from(name).length > MAX_NAME) {
      errors.push(`第 ${lineNo} 行：姓名缺失或超过 ${MAX_NAME} 字`)
      return
    }
    if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
      errors.push(`第 ${lineNo} 行：金额无效（${amountRaw || '空'}）`)
      return
    }
    records.push({ name, amount, type: PAYMENT_TYPES.includes(typeRaw) ? typeRaw : '现金', relation, remarks })
  })
  return { records, errors }
}

export function openImport() {
  if (st.locked) return showAlert('账簿已锁定', '请先解锁账簿后再导入。')
  if (!st.currentEvent?.id) return
  pending = { records: [], errors: [], fileName: '' }
  const html = `
    <div class="import-body">
      <p class="hint">支持 CSV 文件（Excel 可另存为 CSV）。列顺序：姓名、金额、收款方式、关系、备注；带表头会自动识别。</p>
      <input type="file" id="import-file" accept=".csv,text/csv" />
      <div id="import-summary" class="import-summary">尚未选择文件</div>
      <div id="import-preview" class="import-preview"></div>
      <div id="import-error" class="access-error hidden" role="alert"></div>
    </div>`
  openModal('批量导入礼金', { type: 'html', html }, [
    { text: '取消', class: 'modal-btn-ghost' },
    { text: '确认导入', class: 'modal-btn-primary', keepOpen: true, handler: () => confirmImport() },
  ], { size: 'large' })
  afterModalRender(() => {
    document.getElementById('import-file')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const { records, errors } = mapRows(parseCsv(text))
        pending = { records, errors, fileName: file.name }
        renderPreview()
      } catch (error) {
        setError(error?.message || '读取文件失败，请确认是 UTF-8 编码的 CSV。')
      }
    })
  })
}

function setError(message) {
  const el = document.getElementById('import-error')
  if (!el) return
  el.textContent = message || ''
  el.classList.toggle('hidden', !message)
}

function renderPreview() {
  const summary = document.getElementById('import-summary')
  const preview = document.getElementById('import-preview')
  if (!summary || !preview) return
  const { records, errors, fileName } = pending
  if (!fileName) return
  summary.innerHTML = `已解析 <b>${escapeHtml(fileName)}</b>：可导入 <b>${records.length}</b> 条${errors.length ? `，跳过 <b class="text-red-600">${errors.length}</b> 条` : ''}。`
  const head = `<tr>${['姓名', '金额', '收款方式', '关系', '备注'].map((h) => `<th style="border:1px solid #ddd;padding:4px 6px;background:#f7f7f7;font-weight:600">${h}</th>`).join('')}</tr>`
  const body = records
    .slice(0, 8)
    .map((r) => `<tr>${[escapeHtml(r.name), formatCurrency(r.amount), escapeHtml(r.type), escapeHtml(r.relation || '未分类'), escapeHtml(r.remarks || '')].map((c) => `<td style="border:1px solid #ddd;padding:4px 6px">${c}</td>`).join('')}</tr>`)
    .join('')
  const more = records.length > 8 ? `<p class="hint">仅预览前 8 条，共 ${records.length} 条。</p>` : ''
  const errBox = errors.length ? `<div class="modal-notice modal-notice-warn" style="margin-top:8px"><strong>跳过：</strong><ul>${errors.slice(0, 6).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>${errors.length > 6 ? '<p class="hint">…仅显示前 6 条</p>' : ''}</div>` : ''
  preview.innerHTML = `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">${head}${body}</table></div>${more}${errBox}`
}

async function confirmImport() {
  if (st.locked) return showAlert('账簿已锁定', '请先解锁账簿后再导入。')
  if (!pending.records.length) return showAlert('没有可导入的数据', '请选择 CSV 文件并确认解析结果。')
  const targetId = st.currentEvent?.id
  if (!targetId) return
  const total = pending.records.length
  let done = 0
  let queuedCount = 0
  let failed = 0
  for (const row of pending.records) {
    if (st.currentEvent?.id !== targetId) break
    const gift = { ...row, timestamp: new Date().toISOString(), late: false, source: 'csv-import' }
    try {
      const encryptedContent = await encryptData(gift, st.currentPassword)
      const record = { eventId: targetId, encryptedContent, requestId: newRequestId() }
      const queued = enqueueGift(record)
      try {
        await api.createGift(record)
        if (queued) removeQueued(queued.qid)
        done += 1
      } catch (error) {
        if (error instanceof ApiError && (error.code === 'REJECT' || error.code === 'UNAUTHORIZED')) {
          if (queued) removeQueued(queued.qid)
          failed += 1
        } else {
          queuedCount += 1
        }
      }
    } catch {
      failed += 1
    }
  }
  touchSession()
  paintQueueCount()
  await loadGiftsForCurrentEvent()
  closeModal()
  const parts = [`成功 ${done} / ${total} 条`]
  if (queuedCount) parts.push(`暂存待补传 ${queuedCount} 条`)
  if (failed) parts.push(`失败 ${failed} 条`)
  showAlert('导入完成', `${parts.join('，')}。`)
}

// 记账页的全部业务动作：录入、修改留痕、详情、统计、导出、打印、设置、锁定、OCR。
import { state as st, hashPassword, NO_PASSWORD_KEY, rememberLedgerKey, touchSession, clearSession } from '../store.js'
import { api, ApiError } from './api.js'
import { openModal, closeModal, alert as showAlert, afterModalRender } from './modal.js'
import { copyOf, isSolemnEvent, getCoverTemplate } from './content.js'
import { stampSeal } from './stamp.js'
import { amountToChinese, formatCurrency } from './crypto.js'
import { encryptData, decryptData, loadGiftsForCurrentEvent, syncEventTotal, setSyncStatus, showHome, startSession } from '../bootstrap.js'
import { newRequestId, NO_PASSWORD_HASH } from './crypto.js'
import { enqueueGift, removeQueued, queueFor, readQueue, readCache } from './offline.js'
import { toast } from './toast.js'
import { probeAllLinks } from './network.js'
import { ledgerKeyOf, verifyLedgerPassword } from './actions.js'
import { getVoiceOptions, qrStorageKey } from './prefs.js'
import { speakText, previewVoice } from './voice.js'
import { showQrImage } from './qr.js'
import { returnRecordsOf, totalReturnedOf, appendReturn, removeReturn } from './return-gift.js'

export const MAX_GIFT_NAME = 20
export const MAX_GIFT_AMOUNT = 1000000
export const MIN_GIFT_AMOUNT = 0.01

// ---- 录入 ----

export async function submitGift(giftData, resetForm) {
  if (st.locked) return showAlert('账簿已锁定', '请先解锁账簿后再录入。')
  const name = String(giftData.name || '').trim()
  const amountText = String(giftData.amount ?? '')
  const type = giftData.type
  const remarks = String(giftData.remarks || '').trim()
  const relation = String(giftData.relation || '').trim()
  if (!name || !amountText || !type) return showAlert('信息不完整', '请输入姓名、金额并选择收款方式。')
  if (Array.from(name).length > MAX_GIFT_NAME) return showAlert('姓名过长', `姓名请控制在 ${MAX_GIFT_NAME} 个字以内。`)
  const amount = Number(amountText)
  if (!Number.isFinite(amount) || amount < MIN_GIFT_AMOUNT || amount > MAX_GIFT_AMOUNT) {
    return showAlert('金额超出范围', `单笔金额需在 ${MIN_GIFT_AMOUNT} ~ ${MAX_GIFT_AMOUNT.toLocaleString('zh-CN')} 元之间。`)
  }
  if (Math.abs(Math.round(amount * 100) - amount * 100) > 0.0001) return showAlert('金额无效', '金额最多保留两位小数。')

  const sameName = st.gifts.filter((g) => g.data?.name === name)
  const exactMatch = sameName.some((g) => g.data?.amount === amount)
  const start = new Date(st.currentEvent.startDateTime).getTime()
  const end = new Date(st.currentEvent.endDateTime).getTime()
  const hasWindow = Number.isFinite(start) && Number.isFinite(end)
  const outOfTime = hasWindow && (Date.now() < start || Date.now() > end)
  if (outOfTime && isSolemnEvent(st.currentEvent, st.homeCategory)) {
    return showAlert('白事已停止录入', '这本白事账簿已超出设定的起止时间，录入已关闭。<br>如确需补录，请先在「设置」里调整结束时间。')
  }
  showConfirmation(name, amount, remarks, relation, sameName.length > 0, exactMatch, outOfTime, type, resetForm)
}

function showConfirmation(name, amount, remarks, relation, nameExists, exactMatch, outOfTime, type, resetForm) {
  const copy = copyOf(st.currentEvent, st.homeCategory)
  let title = '请确认录入信息'
  // 这个窗口每录一笔都会看一次，所以把要核对的三项立起来：
  // 姓名一行、金额大一号、大写压在金额下面，一眼能对完。
  let body = `
    <dl class="confirm-slip">
      <div><dt>${copy.confirmGuestLabel}</dt><dd class="confirm-name">${escapeHtml(name)}</dd></div>
      <div><dt>金额</dt><dd class="confirm-amount">${formatCurrency(amount)}</dd></div>
      ${relation ? `<div><dt>关系</dt><dd>${escapeHtml(relation)}</dd></div>` : ''}
      <div><dt>大写</dt><dd class="confirm-chinese">${amountToChinese(amount)}</dd></div>
    </dl>`
  if (exactMatch) {
    title = '重复信息确认'
    body = `
      <div class="space-y-3 text-left">
        <div class="modal-notice modal-notice-warn"><strong class="font-bold">警告：</strong><p class="text-sm">系统中已存在“相同姓名”且“相同金额”的记录，为避免重复录入，请仔细核对。</p></div>
        <p><strong>${copy.confirmGuestLabel}:</strong> <span class="text-lg">${escapeHtml(name)}</span></p>
        <p><strong>金额:</strong> <span class="font-bold text-xl themed-text">${formatCurrency(amount)}</span></p>
        <div><label for="modal-remarks-input" class="block text-sm font-medium text-gray-700">如非重复，建议填写备注(选填)</label><textarea id="modal-remarks-input" placeholder="${escapeHtml(copy.remarksTip)}" class="w-full mt-1 p-2 border rounded themed-ring" rows="2">${escapeHtml(remarks)}</textarea></div>
      </div>`
  } else if (nameExists) {
    title = '同名提醒与信息确认'
    body = `
      <div class="space-y-3 text-left">
        <div class="modal-notice modal-notice-warn"><strong>注意：</strong>系统中已存在名为 <strong>${escapeHtml(name)}</strong> 的记录。为避免混淆，建议您添加备注。</div>
        <p><strong>${copy.confirmGuestLabel}:</strong> <span class="text-lg">${escapeHtml(name)}</span></p>
        <p><strong>金额:</strong> <span class="font-bold text-xl themed-text">${formatCurrency(amount)}</span></p>
        <div><label for="modal-remarks-input" class="block text-sm font-medium text-gray-700">备注 (选填)</label><textarea id="modal-remarks-input" placeholder="${escapeHtml(copy.remarksTip)}" class="w-full mt-1 p-2 border rounded themed-ring" rows="2">${escapeHtml(remarks)}</textarea></div>
      </div>`
  }
  if (outOfTime) {
    body = `<div class="modal-notice modal-notice-late"><strong>提示：</strong>本次已超出账簿设定的起止时间，属于补录；保存后照常计入总额与修改记录。</div>${body}`
  }
  let confirmed = false
  openModal(title, { type: 'html', html: body }, [
    { text: '返回修改', class: 'themed-button-secondary border px-4 py-2 rounded' },
    {
      text: '确认提交',
      class: 'themed-button-primary px-4 py-2 rounded',
      keepOpen: true,
      handler: async () => {
        if (confirmed) return
        confirmed = true
        const finalRemarks = document.getElementById('modal-remarks-input')?.value.trim() ?? remarks
        await saveGift({ name, amount, type, remarks: finalRemarks, relation }, resetForm)
      },
    },
  ])
}

async function saveGift(giftData, resetForm) {
  if (st.locked) {
    closeModal()
    return showAlert('账簿已锁定', '请先解锁账簿后再录入。')
  }
  const start = new Date(st.currentEvent.startDateTime)
  const end = new Date(st.currentEvent.endDateTime)
  const now = new Date()
  const hasWindow = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
  const late = hasWindow && (now < start || now > end)

  let queued = null
  let record = null
  try {
    const fullGift = { ...giftData, timestamp: new Date().toISOString(), late }
    const encryptedContent = await encryptData(fullGift, st.currentPassword)
    record = { eventId: st.currentEvent.id, encryptedContent, requestId: newRequestId() }
    queued = enqueueGift(record)
    await api.createGift(record)
    if (queued) removeQueued(queued.qid)
    closeModal()
    resetForm?.()
    // 记一笔，盖一个章：给操作一个看得见的回执
    stampSeal(getCoverTemplate(st.currentEvent, st.homeCategory).glyph)
    speakGift(giftData.name, giftData.amount)
    touchSession()
    await loadGiftsForCurrentEvent()
  } catch (error) {
    closeModal()
    if (record && queued) {
      if (error instanceof ApiError && error.code === 'REJECT') {
        removeQueued(queued.qid)
        showAlert('错误', `录入失败：${error.message}`)
        return
      }
      await handleOffline(record, giftData, queued, error instanceof ApiError && error.code !== 'NETWORK')
      return
    }
    showAlert('错误', error.message ? `录入失败：${error.message}` : '录入失败。')
  }
}

async function handleOffline(record, giftData, item, serverIssue) {
  st.gifts.push({
    id: item.qid,
    eventId: record.eventId,
    encryptedContent: record.encryptedContent,
    pending: true,
    data: { ...giftData, timestamp: item.queuedAt },
  })
  st.currentPage = Math.ceil(st.gifts.length / 12) || 1
  if (serverIssue) {
    setSyncStatus('服务暂时不可用，这一笔已加密暂存在本机，恢复后会自动补传。', true)
    return
  }
  const probes = await probeAllLinks()
  const failed = probes.filter((p) => !p.result.ok).map((p) => p.target.label)
  toast.show({
    text: `${failed.length ? `无法连接：<strong>${failed.join('、')}</strong>。` : '刚才的请求超时了。'}「${escapeHtml(giftData.name)} ¥${escapeHtml(giftData.amount)}」已加密暂存在本机（共 ${queueFor(record.eventId).length} 条），网络恢复后会自动补传。`,
    links: probes.map(({ target, result }) => ({ label: target.label, ok: result.ok, ms: result.ms })),
  })
  toast.onRetry = () => flushQueue(true)
}

// ---- 补传 ----

let flushing = false

export async function flushQueue(manual = false) {
  if (flushing) return { sent: 0 }
  const list = readQueue()
  if (!list.length) return { sent: 0 }
  if (navigator.onLine === false) {
    if (manual) setSyncStatus('当前处于离线状态，网络恢复后自动补传。', true)
    return { sent: 0 }
  }
  flushing = true
  let sent = 0
  let rejected = 0
  for (const item of list) {
    try {
      await api.createGift({ eventId: item.eventId, encryptedContent: item.encryptedContent, requestId: item.requestId })
      removeQueued(item.qid)
      sent += 1
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'LEDGER_KEY' || error.code === 'LEDGER_LOCKED')) continue
      if (!(error instanceof ApiError && error.code === 'REJECT')) break
      removeQueued(item.qid)
      rejected += 1
    }
  }
  flushing = false
  if (sent && st.currentEvent) {
    touchSession()
    await loadGiftsForCurrentEvent()
    setSyncStatus(`已补传 ${sent} 条暂存${copyOf(st.currentEvent, st.homeCategory).recordNoun}`, false)
    setTimeout(() => setSyncStatus(''), 4000)
  } else if (rejected) {
    setSyncStatus(`${rejected} 条暂存记录被服务端拒绝，已移除`, true)
  } else if (manual) {
    setSyncStatus('仍然连不上 NAS，记录继续留在本机。', true)
  }
  return { sent }
}

export function showQueueModal() {
  const list = queueFor(st.currentEvent.id)
  if (!list.length) return showAlert('暂无待同步', `所有${copyOf(st.currentEvent, st.homeCategory).recordNoun}都已写入 NAS。`)
  const rows = list
    .map((item) => {
      const data = decryptData(item.encryptedContent, st.currentPassword) || {}
      const amount = Number(data.amount)
      return `<tr><td>${data.name ? escapeHtml(data.name) : '（密文记录）'}</td><td class="num">${Number.isFinite(amount) ? `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td><td class="num">${new Date(item.queuedAt).toLocaleTimeString('zh-CN', { hour12: false })}</td></tr>`
    })
    .join('')
  openModal(
    '待同步记录',
    { type: 'html', html: `<p class="offline-lead">以下 ${list.length} 条只保存在本浏览器，尚未写入 NAS。</p><table class="net-detail-table"><thead><tr><th>姓名</th><th class="num">金额</th><th class="num">暂存时间</th></tr></thead><tbody>${rows}</tbody></table><p class="net-detail-note">网络恢复后会自动补传；补传成功后这里会自动清空。</p>` },
    [
      { text: '立即同步', class: 'modal-btn-primary', keepOpen: true, handler: () => flushQueue(true) },
      { text: '关闭', class: 'modal-btn-ghost' },
    ],
  )
}

// ---- 详情与修改 ----

export function openGiftDetails(index) {
  const gift = st.gifts[index]
  if (!gift) return
  const data = gift.data
  const copy = copyOf(st.currentEvent, st.homeCategory)
  const history = Array.isArray(data.history) ? data.history : []
  const hasHistory = history.length > 0
  const lastTouch = hasHistory ? (data.updatedAt || data.timestamp) : data.timestamp
  const when = lastTouch ? new Date(lastTouch).toLocaleString('zh-CN') : ''
  const late = isLate(gift) ? '<div class="modal-notice modal-notice-late"><strong>补录记录：</strong>录入时间已超出账簿设定的起止时间，照常计入总额与修改记录。</div>' : ''
  const warning = hasHistory ? `<div class="modal-notice modal-notice-warn">${copy.historyWarning}</div>` : ''
  const returns = returnRecordsOf(data)
  const returnTotal = totalReturnedOf(data)
  const details = `
    <div class="space-y-4 text-left h-full flex flex-col" data-details-index="${index}">
      <h4 class="font-bold text-lg border-b pb-2 mb-2">当前记录信息</h4>
      <div class="flex justify-between items-center p-2 hover:bg-gray-50 rounded">
        <div><strong>姓名:</strong> <span class="text-lg ml-2">${escapeHtml(data.name)}</span></div>
        <button class="text-sm text-blue-600 hover:underline px-2 py-1" data-edit="name">纠错</button>
      </div>
      <div class="flex justify-between items-center p-2 hover:bg-gray-50 rounded">
        <div><p><strong>金额:</strong> <span class="font-bold themed-text text-lg ml-2">${formatCurrency(data.amount)}</span></p><p class="text-sm text-gray-500 mt-1"><strong>类型:</strong> ${escapeHtml(data.type)}</p></div>
        <button class="text-sm text-blue-600 hover:underline px-2 py-1" data-edit="amount">修改</button>
      </div>
      <div class="p-2 hover:bg-gray-50 rounded">
        <div class="flex justify-between items-start"><strong>备注:</strong><button class="text-sm text-blue-600 hover:underline px-2 py-1" data-edit="remarks">修改</button></div>
        <p class="pl-2 mt-1 text-gray-700 bg-gray-50 p-2 rounded">${data.remarks ? escapeHtml(data.remarks) : '（无备注）'}</p>
      </div>
      <div class="p-2 hover:bg-gray-50 rounded">
        <div class="flex justify-between items-start"><strong>回礼:</strong><button class="text-sm text-blue-600 hover:underline px-2 py-1" data-edit="return">登记一次</button></div>
        ${returns.length
          ? `<div class="pl-2 mt-1 text-gray-700 bg-gray-50 p-2 rounded">
              <p class="text-sm"><b>累计 ${formatCurrency(returnTotal)}</b> <span class="text-gray-500">（${returns.length} 次）</span></p>
              <ul class="mt-1 space-y-1">${returns.map((r, i) => `<li class="flex items-center justify-between gap-2 text-sm"><span>${r.timestamp ? new Date(r.timestamp).toLocaleDateString('zh-CN') : '—'} · ${formatCurrency(r.amount)}${r.note ? ` · ${escapeHtml(r.note)}` : ''}</span><button type="button" class="text-xs text-red-600 hover:underline" data-remove-return="${i}">撤销</button></li>`).join('')}</ul>
            </div>`
          : '<p class="pl-2 mt-1 text-gray-700 bg-gray-50 p-2 rounded">未回礼</p>'}
      </div>
      <div class="mt-auto pt-4 text-xs text-gray-400 border-t">
        <div>${hasHistory ? `已修改 ${history.length} 次 · 最后一次 ${when}` : `录入时间 ${when}`}</div>
        <div class="mt-1">记录不支持删除，纠错会保留修改痕迹</div>
      </div>
    </div>`
  const timeline = hasHistory
    ? `<div class="grid grid-cols-1 md:grid-cols-5 gap-6"><div class="md:col-span-2 border-r pr-4 overflow-y-auto">${details}</div><div class="md:col-span-3 pl-2 overflow-y-auto bg-gray-50 rounded-lg p-4"><h4 class="font-bold text-lg border-b pb-2 mb-4">历史修改痕迹</h4>${renderTimeline(history, data)}</div></div>`
    : details
  openModal(
    `${data.name} 的${copy.detailTitle}`,
    { type: 'html', html: late + warning + timeline },
    [{ text: '关闭', class: 'themed-button-secondary border px-4 py-2 rounded' }],
    { size: hasHistory ? 'large' : 'default' },
  )
  afterModalRender(() => {
    const container = document.querySelector('[data-details-index]')
    container?.addEventListener('click', (event) => {
      const field = event.target.closest('[data-edit]')?.dataset.edit
      if (field) return showInlineEdit(index, field)
      const removeIndex = event.target.closest('[data-remove-return]')?.dataset.removeReturn
      if (removeIndex !== undefined && removeIndex !== '') {
        const i = Number(removeIndex)
        const removed = returnRecordsOf(st.gifts[index]?.data)[i]
        updateWithHistory(index, removeReturn(st.gifts[index].data, i), `撤销第 ${i + 1} 次回礼${removed ? ` ${formatCurrency(removed.amount)}` : ''}`)
      }
    })
  })
}

function renderTimeline(history, current) {
  const reversed = [...history].reverse()
  return `<ul class="space-y-4 border-l-2 border-gray-300 ml-2">${reversed
    .map((record, idx) => `<li class="relative pl-6 pb-4"><div class="absolute w-3 h-3 bg-gray-400 rounded-full -left-[7px] top-1 border-2 border-white"></div><div class="text-sm text-gray-500">${new Date(record.timestamp).toLocaleString('zh-CN')}</div><div class="font-medium text-gray-800 mt-1">${escapeHtml(record.changeLog)}</div></li>`)
    .join('')}<li class="relative pl-6"><div class="absolute w-3 h-3 bg-green-500 rounded-full -left-[7px] top-1 border-2 border-white"></div><div class="text-sm text-gray-500">当前状态 (${new Date(current.updatedAt || current.timestamp).toLocaleString('zh-CN')})</div></li></ul>`
}

function showInlineEdit(index, field) {
  const gift = st.gifts[index]
  const data = gift.data
  const copy = copyOf(st.currentEvent, st.homeCategory)
  let html = ''
  if (field === 'name') {
    html = `<div class="themed-edit-area"><label>纠错姓名</label><input type="text" id="inline-edit-name" value="${escapeHtml(data.name)}" maxlength="20" class="w-full p-2 border rounded themed-ring mb-2" /><div class="flex justify-end space-x-2"><button class="text-sm px-3 py-1 rounded themed-button-secondary border" data-cancel>取消</button><button class="text-sm px-3 py-1 rounded themed-button-primary" data-save>验证并保存</button></div></div>`
  } else if (field === 'amount') {
    html = `<div class="themed-edit-area"><label>修改金额与类型</label><input type="number" id="inline-edit-amount" value="${escapeHtml(data.amount)}" min="0.01" max="1000000" step="0.01" class="w-full p-2 border rounded themed-ring mb-2" /><div class="flex flex-wrap gap-x-3 gap-y-1 mb-2">${['现金', '支付宝', '微信', '其他'].map((t) => `<label class="flex items-center text-sm font-normal"><input type="radio" name="inline-edit-type" value="${t}" ${data.type === t ? 'checked' : ''} class="mr-1 themed-ring" />${t}</label>`).join('')}</div><div class="flex justify-end space-x-2"><button class="text-sm px-3 py-1 rounded themed-button-secondary border" data-cancel>取消</button><button class="text-sm px-3 py-1 rounded themed-button-primary" data-save>验证并保存</button></div></div>`
  } else if (field === 'return') {
    const returns = returnRecordsOf(data)
    const total = totalReturnedOf(data)
    html = `<div class="themed-edit-area"><label>回礼登记 <small class="text-gray-500">可多次登记，按次累计</small></label>
      ${returns.length
        ? `<ul class="mb-2 space-y-1 text-sm bg-gray-50 rounded p-2">${returns.map((r) => `<li class="flex justify-between gap-2"><span>${r.timestamp ? new Date(r.timestamp).toLocaleDateString('zh-CN') : '—'} · ${formatCurrency(r.amount)}${r.note ? ` · ${escapeHtml(r.note)}` : ''}</span></li>`).join('')}</ul><p class="text-xs text-gray-500 mb-2">累计已回礼 <b>${formatCurrency(total)}</b>（${returns.length} 次）</p>`
        : '<p class="text-xs text-gray-500 mb-2">尚未回礼，可在下面登记第一次；之后还能继续追加。</p>'}
      <input type="number" id="inline-return-amount" min="0.01" max="1000000" step="0.01" placeholder="本次回礼金额（元）" class="w-full p-2 border rounded themed-ring mb-2" />
      <input type="text" id="inline-return-note" maxlength="200" placeholder="备注（选填，如：回赠茶叶）" class="w-full p-2 border rounded themed-ring mb-2" />
      <p class="text-xs text-gray-500 mb-2">每登记一次会追加一条记录，并写入修改痕迹，可随时撤销。</p>
      <div class="flex justify-end space-x-2"><button class="text-sm px-3 py-1 rounded themed-button-secondary border" data-cancel>取消</button><button class="text-sm px-3 py-1 rounded themed-button-primary" data-save>添加回礼</button></div></div>`
  } else {
    html = `<div class="themed-edit-area"><label>修改备注</label><textarea id="inline-edit-remarks" class="w-full p-2 border rounded themed-ring mb-2" rows="3">${escapeHtml(data.remarks || '')}</textarea><div class="flex justify-end space-x-2"><button class="text-sm px-3 py-1 rounded themed-button-secondary border" data-cancel>取消</button><button class="text-sm px-3 py-1 rounded themed-button-primary" data-save>验证并保存</button></div></div>`
  }
  openModal('修改确认', { type: 'html', html }, [{ text: '关闭', class: 'modal-btn-ghost' }])
  afterModalRender(() => {
  document.querySelector('[data-cancel]')?.addEventListener('click', () => openGiftDetails(index))
  document.querySelector('[data-save]')?.addEventListener('click', async () => {
    if (field === 'name') {
      const next = document.getElementById('inline-edit-name').value.trim()
      if (!next || next === data.name) return openGiftDetails(index)
      if (Array.from(next).length > MAX_GIFT_NAME) return showAlert('姓名过长', `姓名请控制在 ${MAX_GIFT_NAME} 个字以内。`)
      await updateWithHistory(index, { name: next }, `将姓名由 “${data.name}” 更正为 “${next}”`)
    } else if (field === 'amount') {
      const value = parseFloat(document.getElementById('inline-edit-amount').value)
      const type = document.querySelector('input[name="inline-edit-type"]:checked')?.value
      if (!Number.isFinite(value) || value < MIN_GIFT_AMOUNT || value > MAX_GIFT_AMOUNT) return showAlert('金额超出范围', `单笔金额需在 ${MIN_GIFT_AMOUNT} ~ ${MAX_GIFT_AMOUNT.toLocaleString('zh-CN')} 元之间。`)
      if (value === data.amount && type === data.type) return openGiftDetails(index)
      const logs = []
      if (value !== data.amount) logs.push(`金额由 ${data.amount} 修改为 ${value}`)
      if (type !== data.type) logs.push(`类型由 ${data.type} 修改为 ${type}`)
      await updateWithHistory(index, { amount: value, type }, logs.join('，'))
    } else if (field === 'return') {
      const amount = parseFloat(document.getElementById('inline-return-amount')?.value)
      const note = document.getElementById('inline-return-note')?.value.trim() || ''
      if (!Number.isFinite(amount) || amount < MIN_GIFT_AMOUNT || amount > MAX_GIFT_AMOUNT) {
        return showAlert('回礼金额无效', `请输入 ${MIN_GIFT_AMOUNT} ~ ${MAX_GIFT_AMOUNT.toLocaleString('zh-CN')} 元之间的金额。`)
      }
      const patch = appendReturn(data, amount, note)
      await updateWithHistory(index, patch, `登记第 ${patch.returnRecords.length} 次回礼 ${formatCurrency(amount)}${note ? `（${note}）` : ''}`)
    } else {
      const next = document.getElementById('inline-edit-remarks').value.trim()
      if (next === (data.remarks || '')) return openGiftDetails(index)
      await updateWithHistory(index, { remarks: next }, `将备注由 “${data.remarks || '（空）'}” 修改为 “${next || '（空）'}”`)
    }
  })
  })
}

export async function updateWithHistory(index, fields, changeLog) {
  if (st.locked) return showAlert('账簿已锁定', '请先解锁账簿后再修改。')
  const gift = st.gifts[index]
  const current = { ...gift.data }
  const now = new Date().toISOString()
  const snapshot = { name: current.name, amount: current.amount, type: current.type, remarks: current.remarks, timestamp: current.timestamp }
  const historyEntry = { timestamp: now, changeLog, snapshot }
  const updated = {
    ...current,
    ...fields,
    // 登记顺序以首次录入时间为准：修改只写 updatedAt，绝不动 timestamp。
    updatedAt: now,
    late: isLate(gift),
    history: Array.isArray(current.history) ? [...current.history, historyEntry] : [historyEntry],
  }
  try {
    const encryptedContent = await encryptData(updated, st.currentPassword)
    const body = { encryptedContent }
    if (gift.encryptedContent) body.ifMatch = hashPassword(gift.encryptedContent)
    await api.updateGift(st.currentEvent.id, gift.id, body)
    gift.data = updated
    gift.encryptedContent = encryptedContent
    closeModal()
    syncEventTotal()
    setTimeout(() => openGiftDetails(index), 200)
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      showAlert('未保存', error.message || '这笔记录已在其他设备上修改，请刷新后再改。')
      loadGiftsForCurrentEvent()
    } else {
      showAlert('系统错误', '保存修改记录时失败。')
    }
  }
}

function isLate(gift) {
  const data = gift?.data
  if (!data) return false
  if (data.late === true) return true
  if (data.late === false) return false
  const ev = st.currentEvent
  const at = data.timestamp ? new Date(data.timestamp).getTime() : NaN
  if (!ev || !Number.isFinite(at)) return false
  const start = ev.startDateTime ? new Date(ev.startDateTime).getTime() : NaN
  const end = ev.endDateTime ? new Date(ev.endDateTime).getTime() : NaN
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  return at < start || at > end
}

// ---- 查询 ----

export async function runSearch(name, amountText) {
  const normalize = (value) => String(value || '').replace(/[\s　​-‍﻿]/g, '')
  const nameTerm = normalize(name)
  const amountRaw = String(amountText ?? '').trim()
  if (!nameTerm && amountRaw === '') return showAlert('提示', '请输入姓名或金额后再查询。')
  const amountTerm = amountRaw === '' ? null : Number(amountRaw)
  if (amountTerm !== null && (!Number.isFinite(amountTerm) || amountTerm < 0)) return showAlert('提示', '请输入有效的金额。')
  const results = st.gifts
    .map((g, index) => ({ ...g, originalIndex: index }))
    .filter((g) => {
      if (!g.data) return false
      const names = [g.data.name, g.data.giverName, g.giverName, g.name].filter(Boolean).map(normalize)
      const nameOk = !nameTerm || names.some((n) => n.includes(nameTerm))
      const amountOk = amountTerm === null || Math.abs(Number(g.data.amount) - amountTerm) < 0.005
      return nameOk && amountOk
    })
  const criteria = []
  if (nameTerm) criteria.push(`姓名包含「${nameTerm}」`)
  if (amountTerm !== null) criteria.push(`金额 ${formatCurrency(amountTerm)}`)
  if (!results.length) return showAlert('查找结果', escapeHtml(`没有找到${criteria.join('、')}的记录。`))

  const rows = results
    .map(
      (r) => `
      <li class="search-row">
        <div class="search-row-main">
          <span class="search-avatar" aria-hidden="true">${escapeHtml(Array.from(String(r.data.name || '?'))[0] || '?')}</span>
          <div class="search-row-body">
            <div class="search-row-head">
              <span class="search-row-name">${escapeHtml(r.data.name)}</span>
              <span class="search-row-amount">${formatCurrency(r.data.amount)}</span>
            </div>
            <div class="search-row-meta">
              <span>${escapeHtml(r.data.type || '未填')}</span>
              ${isLate(r) ? '<span class="search-row-late">补录</span>' : ''}
              ${r.data.remarks ? `<span class="search-row-remark">${escapeHtml(r.data.remarks)}</span>` : ''}
            </div>
          </div>
        </div>
        <button class="view-details-btn search-row-action" data-gift-index="${r.originalIndex}" type="button">详情</button>
      </li>`,
    )
    .join('')

  const html = `
    <div class="search-panel">
      <div class="search-summary">
        <span>共找到 <b>${results.length}</b> 条记录</span>
        <span class="search-summary-criteria">${escapeHtml(criteria.join(' · '))}</span>
      </div>
      <ul class="search-list">${rows}</ul>
    </div>`

  openModal(
    '查找结果',
    { type: 'html', html },
    [{ text: '关闭', class: 'modal-btn-ghost' }],
  )
  afterModalRender(() => {
    document.querySelectorAll('.view-details-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = Number(btn.dataset.giftIndex)
        closeModal()
        setTimeout(() => openGiftDetails(index), 150)
      })
    })
  })
}

// ---- 助手 ----

function speakGift(name, amount) {
  const ev = st.currentEvent
  if (!ev) return
  const min = Number(ev.minSpeechAmount) || 0
  if (ev.voiceEnabled === false || amount < min) return
  const copy = copyOf(ev, st.homeCategory)
  const text = amountToChinese(amount).replace(/陆/g, '六')
  const prefix = copy.voiceAddPrefix
  const phrase = isSolemnEvent(ev, st.homeCategory) ? `${name}，${prefix}，${text}` : `${name} ${prefix} ${text}`
  speakText(phrase, ev.voiceName)
}

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ---- 导出/统计/打印/设置等入口在其它模块中实现，这里只做转出 ----
export { openExport } from './exports.js'
export { showPrintModal as openPrint } from './printing.js'
export { openStats } from './stats.js'
export { openSettings } from './event-settings.js'
export { toggleLedgerLock } from './lock.js'
export { openOcr } from './ocr-entry.js'
export { showQrDialog } from './qr-dialog.js'

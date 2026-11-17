// 记账页的全部业务动作：录入、修改留痕、详情、统计、导出、打印、设置、锁定、OCR。
import { nextTick } from 'vue'
import { state as st, hashPassword, NO_PASSWORD_KEY, rememberLedgerKey, touchSession, clearSession } from '../store.js'
import { api, ApiError } from './api.js'
import { openModal, closeModal, alert as showAlert, afterModalRender } from './modal.js'
import { safeImport } from './lazy.js'
import { copyOf, isSolemnEvent, getCoverTemplate, RELATION_OPTIONS, RELATION_FALLBACK } from './content.js'
import { stampSeal } from './stamp.js'
import { amountToChinese, formatCurrency } from './crypto.js'
import { encryptData, decryptData, loadGiftsForCurrentEvent, syncEventTotal, setSyncStatus, showHome, startSession } from '../bootstrap.js'
import { newRequestId, NO_PASSWORD_HASH } from './crypto.js'
import { enqueueGift, removeQueued, queueFor, readQueue, readCache } from './offline.js'
import { toast } from './toast.js'
import { notify } from './notify.js'
import { pageOfIndexFor, pageSizeAt } from './page-size.js'
import { probeAllLinks } from './network.js'
import { ledgerKeyOf, verifyLedgerPassword } from './actions.js'
import { getVoiceOptions, qrStorageKey } from './prefs.js'
import { speakText, previewVoice } from './voice.js'
import { showQrImage } from './qr.js'
import { returnRecordsOf, totalReturnedOf, appendReturn, removeReturn, hasReturned } from './return-gift.js'
import { compareGiftsByRegistration, registeredAtOf } from './gift-order.js'
import { markRecentEntry } from './recent-entry.js'
import { isArchived, ensureWritable } from './archive.js'

export const MAX_GIFT_NAME = 20
export const MAX_GIFT_AMOUNT = 1000000
export const MIN_GIFT_AMOUNT = 0
export const MIN_RETURN_AMOUNT = 0.01

// ---- 录入 ----

export async function submitGift(giftData, resetForm) {
  if (!ensureWritable()) return
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
    return showAlert('白事已停止录入', '这本白事账簿已超出设定的起止时间，录入已关闭。\n如确需补录，请先在「设置」里调整结束时间。')
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

// 防重复提交：确认按钮在弱网/手抖时可能被点两次，两次请求的 requestId 不同，
// 服务端无法去重。这里用同步的在途标记把第二次直接挡掉。
let saveInFlight = false

async function saveGift(giftData, resetForm, timestampOverride) {
  if (saveInFlight) return false
  saveInFlight = true
  try {
    return await saveGiftInner(giftData, resetForm, timestampOverride)
  } finally {
    saveInFlight = false
  }
}

async function saveGiftInner(giftData, resetForm, timestampOverride) {
  if (isArchived()) {
    closeModal()
    return ensureWritable()
  }
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
    const fullGift = { ...giftData, timestamp: timestampOverride || new Date().toISOString(), late }
    const encryptedContent = await encryptData(fullGift, st.currentPassword)
    record = { eventId: st.currentEvent.id, encryptedContent, requestId: newRequestId() }
    queued = enqueueGift(record)
    const created = await api.createGift(record)
    if (queued) removeQueued(queued.qid)
    closeModal()
    resetForm?.()
    // 确认弹窗关闭后焦点会离开输入框，Windows 输入法会退回英文。
    // 下一帧把焦点还给姓名框，下一次录入可以直接接着用中文，不用手动切换。
    nextTick(() => {
      const nameInput = document.getElementById('guest-name')
      if (nameInput && !nameInput.disabled) nameInput.focus({ preventScroll: true })
    })
    // 占位行不算一笔真实礼金：不盖章、不朗读、不出录入回执。
    const isBlank = giftData.kind === 'blank'
    if (!isBlank) {
      stampSeal(getCoverTemplate(st.currentEvent, st.homeCategory).glyph)
      speakGift(giftData.name, giftData.amount)
    }
    touchSession()
    // 只解密刚写入的这一条并插入，不再每次记账都重拉整本账簿。
    const createdGift = created?.data
    const createdData = createdGift?.encryptedContent ? decryptData(createdGift.encryptedContent, st.currentPassword) : null
    if (createdGift && createdData) {
      if (!st.gifts.some((g) => g.id === createdGift.id)) {
        st.gifts.push({ ...createdGift, data: createdData })
      }
      st.gifts.sort(compareGiftsByRegistration)
      st.currentPage = pageOfIndexFor(st.gifts.length - 1, st.gifts.length)
      syncEventTotal()
      // 记下这一笔在礼簿里的位置：录入卡片给出回执，礼簿上标出那一格。
      if (!isBlank) {
        markRecentEntry({
          index: st.gifts.findIndex((g) => g.id === createdGift.id),
          name: giftData.name,
          amount: giftData.amount,
        })
      }
    } else {
      // 万一返回内容异常，退回全量刷新，保证界面与数据一致。
      await loadGiftsForCurrentEvent()
    }
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
  st.currentPage = pageOfIndexFor(st.gifts.length - 1, st.gifts.length)
  markRecentEntry({ index: st.gifts.length - 1, name: giftData.name, amount: giftData.amount })
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
  if (st.gifts[index]?.data?.kind === 'blank') return fillBlank(index)
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
  const solemn = isSolemnEvent(st.currentEvent, st.homeCategory)
  // 白事不提供回礼功能：整个回礼区块不渲染。
  const returnBlock = solemn ? '' : `<div class="p-2 hover:bg-gray-50 rounded">
        <div class="flex justify-between items-start"><strong>回礼:</strong><button class="text-sm text-blue-600 hover:underline px-2 py-1" data-edit="return">登记一次</button></div>
        ${returns.length
          ? `<div class="pl-2 mt-1 text-gray-700 bg-gray-50 p-2 rounded">
              <p class="text-sm"><b>累计 ${formatCurrency(returnTotal)}</b> <span class="text-gray-500">（${returns.length} 次）</span></p>
              <ul class="mt-1 space-y-1">${returns.map((r, i) => `<li class="flex items-center justify-between gap-2 text-sm"><span>${r.timestamp ? new Date(r.timestamp).toLocaleDateString('zh-CN') : '—'} · ${formatCurrency(r.amount)}${r.note ? ` · ${escapeHtml(r.note)}` : ''}</span><button type="button" class="text-xs text-red-600 hover:underline" data-remove-return="${i}">撤销</button></li>`).join('')}</ul>
            </div>`
          : '<p class="pl-2 mt-1 text-gray-700 bg-gray-50 p-2 rounded">未回礼</p>'}
      </div>`
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
      <div class="flex justify-between items-center p-2 hover:bg-gray-50 rounded">
        <div><strong>关系:</strong> <span class="ml-2">${escapeHtml(data.relation || RELATION_FALLBACK)}</span></div>
        <button class="text-sm text-blue-600 hover:underline px-2 py-1" data-edit="relation">修改</button>
      </div>
      <div class="p-2 hover:bg-gray-50 rounded">
        <div class="flex justify-between items-start"><strong>备注:</strong><button class="text-sm text-blue-600 hover:underline px-2 py-1" data-edit="remarks">修改</button></div>
        <p class="pl-2 mt-1 text-gray-700 bg-gray-50 p-2 rounded">${data.remarks ? escapeHtml(data.remarks) : '（无备注）'}</p>
      </div>
      ${returnBlock}
      <div class="mt-auto pt-4 text-xs text-gray-400 border-t">
        <div class="whitespace-nowrap">${hasHistory ? `已修改 ${history.length} 次 · 最后一次 ${when}` : `录入时间 ${when}`}</div>
        <div class="mt-1">记录不支持删除，纠错会保留修改痕迹</div>
        ${isArchived() ? '' : '<div class="mt-2 flex gap-2"><button type="button" class="text-sm text-blue-600 hover:underline px-2 py-1" data-insert-blank="before">在此行前插入占位</button><button type="button" class="text-sm text-blue-600 hover:underline px-2 py-1" data-insert-blank="after">在此行后插入占位</button></div>'}
        ${isArchived() ? '<p class="gb-readonly-note">账簿已结簿，现在只能查看</p>' : ''}
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
    // 结簿后详情只展示，去掉所有纠错 / 回礼按钮。
    if (isArchived()) container?.querySelectorAll('[data-edit], [data-remove-return]').forEach((el) => el.remove())
    container?.addEventListener('click', (event) => {
      const insertButton = event.target.closest('[data-insert-blank]')
      if (insertButton) {
        const position = insertButton.dataset.insertBlank === 'after' ? 'after' : 'before'
        closeModal()
        setTimeout(() => insertBlankAt(index, position), 150)
        return
      }
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
  const item = (time, text, isCurrent = false) =>
    `<li class="gb-timeline-item${isCurrent ? ' is-current' : ''}"><span class="gb-timeline-dot" aria-hidden="true"></span><div class="gb-timeline-time">${time}</div>${text ? `<div class="gb-timeline-text">${text}</div>` : ''}</li>`
  return `<ul class="gb-timeline">${reversed
    .map((record) => item(new Date(record.timestamp).toLocaleString('zh-CN'), escapeHtml(record.changeLog)))
    .join('')}${item(`当前状态 (${new Date(current.updatedAt || current.timestamp).toLocaleString('zh-CN')})`, '', true)}</ul>`
}

function showInlineEdit(index, field) {
  const gift = st.gifts[index]
  const data = gift.data
  const copy = copyOf(st.currentEvent, st.homeCategory)
  let html = ''
  if (field === 'name') {
    html = `<div class="themed-edit-area"><label>纠错姓名</label><input type="text" id="inline-edit-name" value="${escapeHtml(data.name)}" maxlength="20" class="w-full p-2 border rounded themed-ring mb-2" /><div class="flex justify-end space-x-2"><button class="text-sm px-3 py-1 rounded themed-button-secondary border" data-cancel>取消</button><button class="text-sm px-3 py-1 rounded themed-button-primary" data-save>验证并保存</button></div></div>`
  } else if (field === 'amount') {
    html = `<div class="themed-edit-area"><label>修改金额与类型</label><input type="number" id="inline-edit-amount" value="${escapeHtml(data.amount)}" min="0" max="1000000" step="0.01" class="w-full p-2 border rounded themed-ring mb-2" /><div class="flex flex-wrap gap-x-3 gap-y-1 mb-2">${['现金', '支付宝', '微信', '其他'].map((t) => `<label class="flex items-center text-sm font-normal"><input type="radio" name="inline-edit-type" value="${t}" ${data.type === t ? 'checked' : ''} class="mr-1 themed-ring" />${t}</label>`).join('')}</div><div class="flex justify-end space-x-2"><button class="text-sm px-3 py-1 rounded themed-button-secondary border" data-cancel>取消</button><button class="text-sm px-3 py-1 rounded themed-button-primary" data-save>验证并保存</button></div></div>`
  } else if (field === 'relation') {
    const current = data.relation || RELATION_FALLBACK
    // 历史数据可能存了不在预设里的关系，补进这一组免得改不了。
    const options = RELATION_OPTIONS.includes(current) ? RELATION_OPTIONS : [current, ...RELATION_OPTIONS]
    html = `<div class="themed-edit-area"><label>修改关系</label><div class="flex flex-wrap gap-x-3 gap-y-1 mb-2">${options.map((r) => `<label class="flex items-center text-sm font-normal"><input type="radio" name="inline-edit-relation" value="${escapeHtml(r)}" ${current === r ? 'checked' : ''} class="mr-1 themed-ring" />${escapeHtml(r)}</label>`).join('')}</div><p class="text-xs text-gray-500 mb-2">修改会写入历史痕迹。</p><div class="flex justify-end space-x-2"><button class="text-sm px-3 py-1 rounded themed-button-secondary border" data-cancel>取消</button><button class="text-sm px-3 py-1 rounded themed-button-primary" data-save>验证并保存</button></div></div>`
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
    } else if (field === 'relation') {
      const relation = document.querySelector('input[name="inline-edit-relation"]:checked')?.value || RELATION_FALLBACK
      const before = data.relation || RELATION_FALLBACK
      if (relation === before) return openGiftDetails(index)
      await updateWithHistory(index, { relation }, `将关系由 “${before}” 修改为 “${relation}”`)
    } else if (field === 'return') {
      const amount = parseFloat(document.getElementById('inline-return-amount')?.value)
      const note = document.getElementById('inline-return-note')?.value.trim() || ''
      if (!Number.isFinite(amount) || amount < MIN_RETURN_AMOUNT || amount > MAX_GIFT_AMOUNT) {
        return showAlert('回礼金额无效', `请输入 ${MIN_RETURN_AMOUNT} ~ ${MAX_GIFT_AMOUNT.toLocaleString('zh-CN')} 元之间的金额。`)
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

// silent 模式下失败时抛给批量调用方，让它停止并说明原因；普通调用仍走弹窗返回 false。
export class GiftUpdateError extends Error {
  constructor(message, conflict = false) {
    super(message)
    this.conflict = conflict
  }
}

// options.silent：批量登记回礼时逐条调用，不弹窗、不重开详情，由调用方统一收尾。
// 空白/跳过：占住纸簿里的一行，不计入人数与金额，之后可以原位补录。
export function submitBlank(resetForm) {
  if (!ensureWritable()) return
  if (st.locked) return showAlert('账簿已锁定', '请先解锁账簿后再录入。')
  const html = `
    <div class="gb-blank-confirm">
      <p>这一行不记礼金，只占住纸簿里的位置；之后可以补录，也可以删除。</p>
      <p class="field-hint">占位行不计入人数与金额。</p>
    </div>`
  openModal('跳过这一行？', { type: 'html', html }, [
    { text: '取消', class: 'modal-btn-ghost' },
    {
      text: '跳过并占位',
      class: 'modal-btn-primary',
      handler: () => saveGift({
        name: '', amount: 0, type: '现金', relation: '', remarks: '',
        kind: 'blank', skippedAt: new Date().toISOString(),
      }, resetForm),
    },
  ], { dismissable: true })
}

// 后续插入占位：before = 插在目标行前，after = 插在目标行后。
// 时间戳取相邻两条的中点，插出来的行正好落在目标位置；插在末尾时取目标时间 +1 秒。
export function insertBlankAt(index, position = 'before') {
  if (!ensureWritable()) return
  if (st.locked) return showAlert('账簿已锁定', '请先解锁账簿后再插入占位。')
  const gift = st.gifts[index]
  if (!gift?.data) return
  const ev = st.currentEvent
  const now = Date.now()
  const start = ev?.startDateTime ? Date.parse(ev.startDateTime) : NaN
  const end = ev?.endDateTime ? Date.parse(ev.endDateTime) : NaN
  if (Number.isFinite(start) && Number.isFinite(end) && (now < start || now > end)) {
    return showAlert('无法插入占位', '已超出账簿设定的有效时间，请先在「账簿设置」里调整起止时间。')
  }
  const targetAt = registeredAtOf(gift)
  const after = position === 'after'
  const neighbor = st.gifts[after ? index + 1 : index - 1]
  const neighborAt = neighbor ? registeredAtOf(neighbor) : NaN
  let at = now - 1
  if (after) {
    if (Number.isFinite(targetAt) && Number.isFinite(neighborAt) && neighborAt - targetAt > 1) {
      at = targetAt + Math.floor((neighborAt - targetAt) / 2)
    } else if (Number.isFinite(targetAt)) {
      at = targetAt + 1000
    }
  } else if (Number.isFinite(neighborAt) && Number.isFinite(targetAt) && targetAt - neighborAt > 1) {
    at = neighborAt + Math.floor((targetAt - neighborAt) / 2)
  } else if (Number.isFinite(targetAt)) {
    at = targetAt - 1
  } else if (Number.isFinite(neighborAt)) {
    at = neighborAt + 1
  }
  const skippedAt = new Date(at).toISOString()
  return saveGift({
    name: '', amount: 0, type: '现金', relation: '', remarks: '',
    kind: 'blank', skippedAt,
  }, null, skippedAt).then(() => {
    const inserted = st.gifts.findIndex((item) => item.data?.kind === 'blank' && item.data.skippedAt === skippedAt)
    if (inserted >= 0) st.currentPage = pageOfIndexFor(inserted, st.gifts.length)
  })
}

export const insertBlankBefore = (index) => insertBlankAt(index, 'before')
export const insertBlankAfter = (index) => insertBlankAt(index, 'after')

// 删除占位行：只有占位可以删，真实礼金仍然不支持删除（要留痕）。
export function deleteBlank(index) {
  const gift = st.gifts[index]
  if (!gift?.data || gift.data.kind !== 'blank') return
  if (st.locked) return showAlert('账簿已锁定', '请先解锁账簿后再删除占位。')
  if (isArchived()) return showAlert('账簿已结簿', '结簿后不能删除占位，请先解除结簿。')
  const html = `
    <div class="gb-delete-blank">
      <p>确定删除这一行「跳过」吗？</p>
      <p class="field-hint is-warning">删除后，后面记录的页内位置会前移一位；如果只是暂时不记，建议保留占位。</p>
    </div>`
  openModal('删除占位行', { type: 'html', html }, [
    { text: '取消', class: 'modal-btn-ghost' },
    {
      text: '删除',
      class: 'modal-btn-danger',
      keepOpen: true,
      handler: async () => {
        try {
          await api.deleteGift(st.currentEvent.id, gift.id)
          closeModal()
          st.gifts.splice(index, 1)
          st.currentPage = Math.min(st.currentPage, Math.max(1, st.gifts.length ? pageOfIndexFor(st.gifts.length - 1, st.gifts.length) : 1))
          notify.success('占位行已删除', '后面的记录已前移。')
        } catch (error) {
          showAlert('删除失败', error.message || '请稍后重试。')
        }
      },
    },
  ], { dismissable: true })
}

// 补录占位行：更新原记录（时间、位置都不变），避免后续序号前移。
export async function fillBlank(index) {
  const gift = st.gifts[index]
  if (!gift?.data || gift.data.kind !== 'blank') return
  const html = `
    <div class="gb-fill-blank">
      <p class="gb-picker-hint">这一行原本是「跳过」。补录后会留在原位置，后面的记录不会前移。</p>
      <div class="field"><label class="field-label" for="fill-name">姓名</label><input id="fill-name" type="text" maxlength="20" autocomplete="off" /></div>
      <div class="field"><label class="field-label" for="fill-amount">金额（元，可填 0）</label><input id="fill-amount" type="number" min="0" max="1000000" step="0.01" inputmode="decimal" value="0" /></div>
      <div class="field"><label class="field-label" for="fill-remarks">备注（选填）</label><input id="fill-remarks" type="text" maxlength="4000" /></div>
      <div id="fill-error" class="gb-inline-error" role="alert"></div>
    </div>`
  openModal('补录跳过行', { type: 'html', html }, [
    { text: '删除这一行', class: 'modal-btn-danger', keepOpen: true, handler: () => {
        closeModal()
        setTimeout(() => deleteBlank(index), 120)
      } },
    { text: '取消', class: 'themed-button-secondary border px-4 py-2 rounded' },
    {
      text: '补录',
      class: 'themed-button-primary px-4 py-2 rounded',
      keepOpen: true,
      handler: async () => {
        const name = document.getElementById('fill-name')?.value.trim() || ''
        const amountText = document.getElementById('fill-amount')?.value ?? ''
        const remarks = document.getElementById('fill-remarks')?.value.trim() || ''
        const errorBox = document.getElementById('fill-error')
        const fail = (message) => { if (errorBox) errorBox.textContent = message }
        if (!name) return fail('请填写姓名')
        const amount = Number(amountText)
        if (!Number.isFinite(amount) || amount < MIN_GIFT_AMOUNT || amount > MAX_GIFT_AMOUNT) {
          return fail('金额需在 0 ~ 1,000,000 元之间')
        }
        const ok = await updateWithHistory(index, {
          name, amount, remarks, type: '现金', relation: '', kind: 'gift', skippedAt: null,
        }, `补录跳过行：${name} ${formatCurrency(amount)}`)
        if (ok) {
          closeModal()
          notify.success('已补录', `「${name}」已留在原位置。`)
        } else {
          fail('补录失败，请稍后重试')
        }
      },
    },
  ], { dismissable: true })
}

// 批量备注：给多条已有记录写同一段话（例如「共同操办」）。
// 默认追加，不覆盖原备注；每条都走 updateWithHistory，保留位置与修改留痕。
export function batchNote() {
  const targets = st.gifts
    .map((gift, index) => ({ gift, index }))
    .filter(({ gift }) => gift?.data && gift.data.kind !== 'blank')
  if (!targets.length) return showAlert('批量备注', '当前账簿还没有可备注的记录。')
  const chosen = new Set()
  let keyword = ''
  const matched = () => targets.filter(({ gift }) => !keyword || String(gift.data?.name || '').includes(keyword))
  const listHtml = () => matched().map(({ gift, index }) => `
      <label class="gb-batch-row">
        <input type="checkbox" value="${index}" ${chosen.has(index) ? 'checked' : ''} />
        <b>${escapeHtml(gift.data?.name || '未命名')}</b>
        <small>${formatCurrency(gift.data?.amount || 0)}${gift.data?.remarks ? ' · 已有备注' : ''}</small>
      </label>`).join('') || '<div class="gb-empty">没有匹配的记录。</div>'
  const html = `
    <div id="gb-batch-note" class="gb-batch-note">
      <p class="gb-picker-intro">对选中的记录批量修改备注、关系或收款方式；不填的项目保持原样。</p>
      <input id="gb-batch-keyword" type="search" placeholder="按姓名查找" autocomplete="off" />
      <div class="gb-batch-tools">
        <button type="button" class="gb-link-btn" data-batch-all>全选当前结果</button>
        <button type="button" class="gb-link-btn" data-batch-none>清空选择</button>
        <span id="gb-batch-count">已选 0 条</span>
      </div>
      <div id="gb-batch-list" class="gb-batch-list">${listHtml()}</div>
      <div class="gb-form-grid">
        <div class="field"><label class="field-label" for="gb-batch-relation">关系</label><select id="gb-batch-relation"><option value="">不修改</option>${RELATION_OPTIONS.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select></div>
        <div class="field"><label class="field-label" for="gb-batch-type">收款方式</label><select id="gb-batch-type"><option value="">不修改</option>${['现金', '支付宝', '微信', '其他'].map((t) => `<option value="${t}">${t}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label class="field-label" for="gb-batch-text">备注内容（选填）</label><textarea id="gb-batch-text" rows="2" maxlength="500" placeholder="如：共同操办"></textarea></div>
      <div class="payment-options">
        <label><input type="radio" name="gb-batch-mode" value="append" checked /><span>备注追加到原文后</span></label>
        <label><input type="radio" name="gb-batch-mode" value="overwrite" /><span>备注覆盖原文</span></label>
      </div>
      <div id="gb-batch-error" class="gb-inline-error" role="alert"></div>
    </div>`
  openModal('批量修改', { type: 'html', html }, [
    { text: '取消', class: 'themed-button-secondary border px-4 py-2 rounded' },
    {
      text: '写入修改',
      class: 'themed-button-primary px-4 py-2 rounded',
      keepOpen: true,
      handler: async () => {
        const text = document.getElementById('gb-batch-text')?.value.trim() || ''
        const relation = document.getElementById('gb-batch-relation')?.value || ''
        const type = document.getElementById('gb-batch-type')?.value || ''
        const mode = document.querySelector('input[name="gb-batch-mode"]:checked')?.value || 'append'
        const box = document.getElementById('gb-batch-error')
        const fail = (message) => { if (box) box.textContent = message }
        if (!text && !relation && !type) return fail('请至少填写备注、关系或收款方式中的一项')
        const indices = [...chosen].sort((a, b) => a - b)
        if (!indices.length) return fail('请先选择记录')
        if (indices.length > 100) return fail('一次最多处理 100 条，请分批操作')
        const labels = []
        if (relation) labels.push(`关系→${relation}`)
        if (type) labels.push(`方式→${type}`)
        if (text) labels.push(`备注：${text}`)
        const log = `批量修改：${labels.join('，')}`
        let done = 0
        for (const index of indices) {
          const current = st.gifts[index]?.data
          if (!current || current.kind === 'blank') continue
          const fields = {}
          if (relation) fields.relation = relation
          if (type) fields.type = type
          if (text) fields.remarks = (mode === 'overwrite' ? text : [current.remarks, text].filter(Boolean).join('；')).slice(0, 4000)
          const ok = await updateWithHistory(index, fields, log, { silent: true })
          if (ok) done += 1
        }
        closeModal()
        if (done) notify.success('批量修改完成', `已更新 ${done} 条记录，原顺序不变。`)
        else fail('没有记录被更新，请重试')
      },
    },
  ], { size: 'large', dismissable: true })
  afterModalRender(() => {
    const root = document.getElementById('gb-batch-note')
    if (!root) return
    const count = document.getElementById('gb-batch-count')
    const sync = () => { if (count) count.textContent = `已选 ${chosen.size} 条` }
    document.getElementById('gb-batch-keyword')?.addEventListener('input', (event) => {
      keyword = event.target.value.trim()
      const list = document.getElementById('gb-batch-list')
      if (list) list.innerHTML = listHtml()
    })
    document.getElementById('gb-batch-list')?.addEventListener('change', (event) => {
      const box = event.target
      if (box?.type !== 'checkbox') return
      const index = Number(box.value)
      if (box.checked) chosen.add(index)
      else chosen.delete(index)
      sync()
    })
    root.addEventListener('click', (event) => {
      const all = event.target.closest('[data-batch-all]')
      if (all) {
        matched().forEach(({ index }) => chosen.add(index))
        const list = document.getElementById('gb-batch-list')
        if (list) list.innerHTML = listHtml()
        sync()
      }
      const none = event.target.closest('[data-batch-none]')
      if (none) {
        chosen.clear()
        const list = document.getElementById('gb-batch-list')
        if (list) list.innerHTML = listHtml()
        sync()
      }
    })
  })
}

export async function updateWithHistory(index, fields, changeLog, options = {}) {
  const silent = options.silent === true
  if (st.locked) {
    if (!silent) showAlert('账簿已锁定', '请先解锁账簿后再修改。')
    return false
  }
  if (isArchived()) {
    if (!silent) showAlert('账簿已结簿', '这本账簿已结簿并设为只读；如需修改请先到「设置」解除结簿。')
    return false
  }
  const gift = st.gifts[index]
  if (!gift) return false
  const current = { ...gift.data }
  const now = new Date().toISOString()
  const snapshot = { name: current.name, amount: current.amount, type: current.type, relation: current.relation, remarks: current.remarks, timestamp: current.timestamp }
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
    syncEventTotal()
    if (!silent) {
      closeModal()
      setTimeout(() => openGiftDetails(index), 200)
    }
    return true
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      if (!silent) showAlert('未保存', error.message || '这笔记录已在其他设备上修改，请刷新后再改。')
      await loadGiftsForCurrentEvent()
      if (silent) throw new GiftUpdateError(error.message || '这笔记录已在其他设备上修改，请刷新后重试。', true)
      return false
    }
    if (!silent) {
      showAlert('系统错误', '保存修改记录时失败。')
    } else {
      throw new GiftUpdateError(error?.message || '保存失败，请检查网络后重试。')
    }
    return false
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

// 把某一笔翻到它所在的页、滚进视野并闪一下描边：搜索定位与录入回执共用。
export async function focusGiftRow(index) {
  const i = Number(index)
  if (!Number.isInteger(i) || i < 0 || i >= st.gifts.length) return false
  const page = pageOfIndexFor(i, st.gifts.length)
  if (page !== st.currentPage) {
    st.currentPage = page
    await nextTick()
  }
  // 刚关掉弹窗时 body 还锁着滚动（overflow:hidden），此时 scrollIntoView 会被忽略；
  // 等锁解开再滚，否则手机上会出现「点了定位但页面没动」。
  await waitScrollUnlocked()
  const cell = document.querySelector(`#gift-book-content .name-cell[data-gift-index="${i}"]`)
  if (!cell) return false
  const reduce = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  cell.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center', inline: 'center' })
  cell.classList.remove('is-focus')
  void cell.offsetWidth
  cell.classList.add('is-focus')
  window.setTimeout(() => cell.classList.remove('is-focus'), 1800)
  return true
}

async function waitScrollUnlocked(timeout = 700) {
  if (typeof document === 'undefined') return
  const locked = () => getComputedStyle(document.body).overflow === 'hidden'
  const start = performance.now()
  while (locked() && performance.now() - start < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

// ---- 查询 ----

export async function runSearch(name, amountText, options = {}) {
  // 手机端点到「查找」时输入框还带着焦点，软键盘会占掉半屏：
  // 先收起键盘，后面翻页定位才不会在缩小的视口里算错位置。
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  const normalize = (value) => String(value || '').replace(/[\s　​-‍﻿]/g, '')
  const nameTerm = normalize(name)
  const amountRaw = String(amountText ?? '').trim()
  if (!nameTerm && amountRaw === '' && !options.unreturned) return showAlert('提示', '请输入姓名或金额后再查询。')
  const amountTerm = amountRaw === '' ? null : Number(amountRaw)
  if (amountTerm !== null && (!Number.isFinite(amountTerm) || amountTerm < 0)) return showAlert('提示', '请输入有效的金额。')
  const results = st.gifts
    .map((g, index) => ({ ...g, originalIndex: index }))
    .filter((g) => {
      if (!g.data) return false
      const names = [g.data.name, g.data.giverName, g.giverName, g.name].filter(Boolean).map(normalize)
      const nameOk = !nameTerm || names.some((n) => n.includes(nameTerm))
      const amountOk = amountTerm === null || Math.abs(Number(g.data.amount) - amountTerm) < 0.005
      const returnOk = !options.unreturned || !hasReturned(g.data)
      return nameOk && amountOk && returnOk
    })
  const criteria = []
  if (nameTerm) criteria.push(`姓名包含「${nameTerm}」`)
  if (amountTerm !== null) criteria.push(`金额 ${formatCurrency(amountTerm)}`)
  if (options.unreturned) criteria.push('仅未回礼')
  if (!results.length) return showAlert('查找结果', escapeHtml(`没有找到${criteria.join('、')}的记录。`))

  // 只命中一条：不绕结果列表，直接翻到那一页再弹详情，
  // 关掉详情时正好停在礼簿里，能看到前后是谁。
  if (results.length === 1) {
    const only = results[0].originalIndex
    closeModal()
    // 留一点时间让软键盘收回去，再算滚动位置。
    await new Promise((resolve) => setTimeout(resolve, 120))
    await focusGiftRow(only)
    setTimeout(() => openGiftDetails(only), 300)
    return
  }

  // 结果多时只先渲染一屏，其余点「显示更多」追加，避免一次性生成上百行 DOM。
  const SEARCH_BATCH = 30
  const rowHtml = (r) => `
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
        <div class="search-row-actions">
          <button class="search-row-locate" data-locate-index="${r.originalIndex}" type="button" aria-label="在礼簿中定位">定位</button>
          <button class="view-details-btn search-row-action" data-gift-index="${r.originalIndex}" type="button">详情</button>
        </div>
      </li>`

  const total = results.length
  const firstBatch = results.slice(0, SEARCH_BATCH).map(rowHtml).join('')
  const moreCount = total - Math.min(total, SEARCH_BATCH)

  const html = `
    <div class="search-panel">
      <div class="search-summary">
        <span>共找到 <b>${total}</b> 条记录</span>
        <span class="search-summary-criteria">${escapeHtml(criteria.join(' · '))}</span>
      </div>
      <ul class="search-list" id="search-list">${firstBatch}</ul>
      ${moreCount > 0 ? `<div class="search-more"><button type="button" id="search-more-btn" class="modal-btn-ghost">显示更多（剩余 ${moreCount} 条）</button></div>` : ''}
    </div>`

  openModal(
    '查找结果',
    { type: 'html', html },
    [{ text: '关闭', class: 'modal-btn-ghost' }],
  )
  afterModalRender(() => {
    const listEl = document.querySelector('#search-list')
    // 事件委托：后续追加的行无需再逐条绑定。
    listEl?.addEventListener('click', (event) => {
      // 「定位」：关掉结果面板，翻到那一页并标出这一格，不弹详情。
      const locate = event.target.closest('.search-row-locate')
      if (locate) {
        const index = Number(locate.dataset.locateIndex)
        closeModal()
        setTimeout(() => focusGiftRow(index), 150)
        return
      }
      const btn = event.target.closest('.view-details-btn')
      if (!btn) return
      const index = Number(btn.dataset.giftIndex)
      closeModal()
      // 详情也先定位：关掉详情时停在礼簿的这一页，能直接看到前后的人。
      setTimeout(async () => {
        await focusGiftRow(index)
        openGiftDetails(index)
      }, 150)
    })
    const moreBtn = document.querySelector('#search-more-btn')
    moreBtn?.addEventListener('click', () => {
      const start = listEl.querySelectorAll('.search-row').length
      const next = results.slice(start, start + SEARCH_BATCH)
      listEl.insertAdjacentHTML('beforeend', next.map(rowHtml).join(''))
      const left = total - (start + next.length)
      if (left > 0) moreBtn.textContent = `显示更多（剩余 ${left} 条）`
      else moreBtn.parentElement?.remove()
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
export { openStats } from './stats.js'
export { openSettings } from './event-settings.js'
export { toggleLedgerLock } from './lock.js'
export { showQrDialog } from './qr-dialog.js'

// 导出（PDF）/ 打印 / OCR 体积大、使用频率低：按需加载，不占首屏主包。
// 统一走 safeImport：旧页面引用已删除的 chunk 时提示刷新，而不是点了没反应。
export async function openExport(...args) {
  const mod = await safeImport(() => import('./exports.js'), '导出')
  if (!mod) return
  return mod.openExport(...args)
}

export async function openPrint(...args) {
  const mod = await safeImport(() => import('./printing.js'), '打印')
  if (!mod) return
  return mod.showPrintModal(...args)
}

export async function openOcr(...args) {
  if (!ensureWritable()) return
  const mod = await safeImport(() => import('./ocr-entry.js'), '扫码识别')
  if (!mod) return
  return mod.openOcr(...args)
}

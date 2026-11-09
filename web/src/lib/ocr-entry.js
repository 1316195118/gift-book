// 扫描礼簿：复用原厂的 OCR 界面（ocr.js），把导入回调接到新版记账流程。
import { state as st } from '../store.js'
import { alert as showAlert } from './modal.js'
import { copyOf, isSolemnEvent } from './content.js'
import { encryptData, loadGiftsForCurrentEvent } from '../bootstrap.js'
import { touchSession } from '../store.js'
import { newRequestId } from './crypto.js'
import { enqueueGift, readQueue, writeQueue } from './offline.js'
import { api, ApiError } from './api.js'
import { paintQueueCount } from './queue-count.js'
import '../lib/ocr.js'

const MAX_GIFT_NAME = 20
const MAX_GIFT_AMOUNT = 1000000
const MIN_GIFT_AMOUNT = 0.01

export function openOcr() {
  const targetId = st.currentEvent?.id
  const ensureWritable = () => {
    if (!targetId || st.currentEvent?.id !== targetId) throw new Error('当前账簿已切换，请重新打开扫描窗口。')
    if (st.locked) throw new Error('账簿已锁定，请先解锁后导入。')
    const start = new Date(st.currentEvent.startDateTime).getTime()
    const end = new Date(st.currentEvent.endDateTime).getTime()
    const outside = Number.isFinite(start) && Number.isFinite(end) && (Date.now() < start || Date.now() > end)
    if (outside && isSolemnEvent(st.currentEvent, st.homeCategory)) throw new Error('白事已超出录入时间，请先在设置中调整时间。')
    return outside
  }
  let lateAtOpen = false
  try {
    lateAtOpen = ensureWritable()
  } catch (error) {
    return showAlert('无法扫描导入', String(error.message))
  }
  if (!window.GiftBookOCR) return showAlert('扫描功能未加载', '请刷新页面后重试。')
  window.GiftBookOCR.open({
    eventName: st.currentEvent.name,
    notice: lateAtOpen ? '此账簿已超出设定的录入时间；本次确认导入的记录将标记为补录，请一并核对。' : '',
    existing: st.gifts.filter((g) => g.data).map((g) => ({ name: g.data.name, amount: g.data.amount })),
    newRequestId,
    importRow: async (row) => {
      const late = ensureWritable()
      if (late && !lateAtOpen) throw new Error('账簿现已超出录入时间，请关闭并重新打开扫描窗口，核对补录提示后再导入。')
      const name = String(row.name || '').trim()
      const amount = Number(row.amount)
      if (
        !name ||
        Array.from(name).length > MAX_GIFT_NAME ||
        !Number.isFinite(amount) ||
        amount < MIN_GIFT_AMOUNT ||
        amount > MAX_GIFT_AMOUNT ||
        Math.abs(Math.round(amount * 100) - amount * 100) > 0.0001 ||
        !['现金', '支付宝', '微信', '其他'].includes(row.type)
      ) {
        throw new Error('姓名、金额或收款方式无效，请重新核对。')
      }
      const fullGift = {
        name,
        amount,
        type: row.type,
        remarks: String(row.remarks || '').slice(0, 4000),
        timestamp: new Date().toISOString(),
        late,
        source: 'paper-ocr',
        ocrReviewed: true,
      }
      const record = { eventId: targetId, encryptedContent: await encryptData(fullGift, st.currentPassword), requestId: row.requestId }
      const queued = enqueueGift(record)
      if (!readQueue().some((item) => item.qid === queued.qid)) {
        throw new Error('浏览器无法安全加密暂存，尚未提交，请检查存储空间后重试。')
      }
      try {
        await api.createGift(record)
        writeQueue(readQueue().filter((item) => item.requestId !== record.requestId))
        touchSession()
        paintQueueCount()
        return { queued: false }
      } catch (error) {
        if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
          writeQueue(readQueue().filter((item) => item.requestId !== record.requestId))
          throw new Error(error.message)
        }
        if (error instanceof ApiError && error.code === 'REJECT') {
          writeQueue(readQueue().filter((item) => item.requestId !== record.requestId))
          throw new Error(error.message || '服务器拒绝了此笔记录，尚未导入。')
        }
        paintQueueCount()
        return { queued: true }
      }
    },
    refresh: async () => {
      if (st.currentEvent?.id !== targetId) return
      paintQueueCount()
      await loadGiftsForCurrentEvent()
    },
  })
}

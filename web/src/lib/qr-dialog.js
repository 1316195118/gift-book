// 收款码：上传/更换/删除，服务端保存一份，本机也留缓存以便断网展示。
import { state as st, updateSessionEvent } from '../store.js'
import { api } from './api.js'
import { openModal, closeModal, alert as showAlert, afterModalRender } from './modal.js'
import { copyOf } from './content.js'
import { escapeHtml } from './crypto.js'
import { qrStorageKey } from './prefs.js'
import { showQrImage } from './qr.js'

export function currentQr() {
  if (st.currentEvent?.qrcode) return st.currentEvent.qrcode
  try {
    return localStorage.getItem(qrStorageKey(st.currentEvent?.id)) || ''
  } catch {
    return ''
  }
}

export function showQrDialog() {
  const ev = st.currentEvent
  const copy = copyOf(ev, st.homeCategory)
  const qr = currentQr()
  const html = qr
    ? `<img src="${escapeHtml(qr)}" class="qr-thumb" alt="收款码" width="640" height="640" loading="lazy" decoding="async" /><p class="text-xs text-gray-500 text-center">${copy.qrTip}</p><input type="file" id="qr-file" accept="image/*" class="mt-3 w-full text-sm" />`
    : `<div class="qr-empty">还没有上传收款码<br/>支持微信 / 支付宝收款码图片</div><input type="file" id="qr-file" accept="image/*" class="mt-3 w-full text-sm" />`
  const actions = [{ text: '关闭', class: 'themed-button-secondary border px-4 py-2 rounded' }]
  if (qr) {
    actions.push({
      text: '删除',
      class: 'border border-red-300 text-red-600 px-4 py-2 rounded',
      handler: () => saveQr(null),
    })
  }
  actions.push({
    text: '上传/更换',
    class: 'themed-button-primary px-4 py-2 rounded',
    keepOpen: true,
    handler: () => uploadQr(),
  })
  openModal('收款码', { type: 'html', html }, actions)
  afterModalRender(() => {
    document.getElementById('qr-file')?.addEventListener('change', () => {
      const img = document.querySelector('.qr-thumb')
      if (!img) return
      const file = document.getElementById('qr-file')?.files?.[0]
      if (file) img.src = URL.createObjectURL(file)
    })
  })
}

function uploadQr() {
  const file = document.getElementById('qr-file')?.files?.[0]
  if (!file) return showAlert('提示', '请先选择一张图片。')
  if (file.size > 5 * 1024 * 1024) return showAlert('提示', '图片请小于 5MB。')
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      const max = 640
      let { width, height } = img
      if (width > max || height > max) {
        const scale = Math.min(max / width, max / height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      saveQr(canvas.toDataURL('image/png'))
    }
    img.onerror = () => showAlert('提示', '图片读取失败，请换一张。')
    img.src = String(reader.result || '')
  }
  reader.readAsDataURL(file)
}

export async function saveQr(dataUrl) {
  const ev = st.currentEvent
  if (!ev) {
    showAlert('保存失败', '当前账簿已关闭，请重新打开后再设置收款码。')
    return
  }
  const key = qrStorageKey(ev?.id)
  let result
  try {
    result = await api.updateEvent(ev.id, { qrcode: dataUrl || null })
  } catch (error) {
    console.warn('收款码同步到服务器失败', error)
    showAlert('未保存', '收款码未能同步到服务器，请检查网络后重试。')
    return
  }
  Object.assign(ev, result?.data || { qrcode: dataUrl || null })
  let localCached = true
  try {
    if (dataUrl) localStorage.setItem(key, dataUrl)
    else localStorage.removeItem(key)
  } catch {
    localCached = false
  }
  updateSessionEvent(ev)
  closeModal()
  const action = dataUrl ? '收款码已保存。' : '收款码已删除。'
  showAlert('已保存', localCached ? action : `${action} 当前浏览器禁用本地存储，因此仅保存在服务器。`)
}

export function showQrFloat() {
  const qr = currentQr()
  if (!qr) return showQrDialog()
  showQrImage(qr)
}

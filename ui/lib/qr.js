// 收款码浮层（原生 JS，零第三方依赖）。收款码本身是用户上传的图片，这里只负责展示。
import { openModal, closeModal, alert as showAlert } from './modal.js'
import { escapeHtml } from './crypto.js'

export const qr = { image: '', visible: false }

// 只接受图片 data URL / 站内路径 / http(s) / blob，避免把任意字符串塞进 src 属性。
const SAFE_SRC = /^(data:image\/(png|jpeg|jpg|gif|webp);base64,|https?:\/\/|\/|\.\/|blob:)/i

export function showQrImage(image) {
  const src = String(image || '')
  if (!src || !SAFE_SRC.test(src)) return
  qr.image = src
  openModal('收款码', { type: 'html', html: `<img src="${escapeHtml(src)}" class="qr-thumb" alt="收款码" />` }, [
    { text: '关闭', class: 'themed-button-secondary border px-4 py-2 rounded' },
  ])
}

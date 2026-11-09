// 收款码浮层（原生 JS，零第三方依赖）。收款码本身是用户上传的图片，这里只负责展示。
import { qr } from '../lib/qr.js'

export function mountQrFloat(root) {
  const el = document.createElement('div')
  el.id = 'qr-float'
  el.className = 'hidden'
  el.innerHTML = `
    <div id="qr-float-head">
      <span>电子收款码 · 按住拖动</span>
      <div class="qr-float-actions">
        <button type="button" id="qr-zoom">放大</button>
        <button type="button" id="qr-collapse">收起</button>
        <button type="button" id="qr-hide">×</button>
      </div>
    </div>
    <div id="qr-float-body">
      <div class="qr-poster">
        <div class="qr-poster-title">请扫码付款</div>
        <img id="qr-float-img" alt="收款码" />
        <div class="qr-poster-foot">微信 · 支付宝 · 云闪付</div>
      </div>
    </div>`
  root.appendChild(el)

  const img = el.querySelector('#qr-float-img')
  const zoomBtn = el.querySelector('#qr-zoom')
  const collapseBtn = el.querySelector('#qr-collapse')
  const hideBtn = el.querySelector('#qr-hide')
  const head = el.querySelector('#qr-float-head')

  const apply = () => {
    el.classList.toggle('hidden', !qr.visible)
    el.classList.toggle('zoomed', Boolean(qr.zoomed))
    el.classList.toggle('collapsed', Boolean(qr.collapsed))
    if (qr.image) img.src = qr.image
    if (qr.positioned) {
      el.style.left = `${qr.left}px`
      el.style.top = `${qr.top}px`
    }
  }

  zoomBtn.addEventListener('click', () => { qr.zoomed = !qr.zoomed; apply() })
  collapseBtn.addEventListener('click', () => { qr.collapsed = !qr.collapsed; apply() })
  hideBtn.addEventListener('click', () => { qr.visible = false; apply() })

  let dragging = false
  let startX = 0
  let startY = 0
  let originX = 0
  let originY = 0
  const begin = (x, y) => {
    dragging = true
    startX = x
    startY = y
    originX = qr.left
    originY = qr.top
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', end)
    window.addEventListener('touchmove', moveTouch, { passive: true })
    window.addEventListener('touchend', end)
  }
  const move = (e) => {
    if (!dragging) return
    const w = 280
    const h = 320
    qr.left = Math.max(0, Math.min(originX + (e.clientX - startX), window.innerWidth - w))
    qr.top = Math.max(0, Math.min(originY + (e.clientY - startY), window.innerHeight - h))
    qr.positioned = true
    el.style.left = `${qr.left}px`
    el.style.top = `${qr.top}px`
  }
  const moveTouch = (e) => move(e.touches[0])
  const end = () => {
    dragging = false
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', end)
    window.removeEventListener('touchmove', moveTouch)
    window.removeEventListener('touchend', end)
  }
  head.addEventListener('mousedown', (e) => { e.preventDefault(); begin(e.clientX, e.clientY) })
  head.addEventListener('touchstart', (e) => begin(e.touches[0].clientX, e.touches[0].clientY), { passive: true })

  apply()
}

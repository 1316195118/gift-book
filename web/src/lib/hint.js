// 统一的「?」说明：模板里写
//   <span class="gb-hint" data-hint="这里填什么" tabindex="0" role="note">?</span>
// 点按或聚焦图标弹出浮层，点空白、按 Esc 或再次点图标关闭。
// 只用一个 DOM 浮层 + 事件委托，避免每个提示各建一层、互相压住。
const MARGIN = 10
let bubble = null
let anchor = null

function ensureBubble() {
  if (bubble && document.body.contains(bubble)) return bubble
  bubble = document.createElement('div')
  bubble.id = 'gb-hint-bubble'
  bubble.setAttribute('role', 'tooltip')
  bubble.hidden = true
  document.body.appendChild(bubble)
  return bubble
}

function place() {
  if (!anchor) return
  const el = ensureBubble()
  const rect = anchor.getBoundingClientRect()
  const width = el.offsetWidth
  const height = el.offsetHeight
  const maxLeft = window.innerWidth - width - MARGIN
  const left = Math.max(MARGIN, Math.min(rect.left + rect.width / 2 - width / 2, maxLeft))
  // 优先放在图标上方，顶部放不下就翻到下方。
  let top = rect.top - height - 8
  if (top < MARGIN) top = rect.bottom + 8
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
}

function show(target) {
  const text = target?.dataset?.hint
  if (!text) return
  const el = ensureBubble()
  if (anchor === target && !el.hidden) {
    hide()
    return
  }
  el.textContent = text
  el.hidden = false
  anchor = target
  target.setAttribute('aria-expanded', 'true')
  place()
}

function hide() {
  if (bubble) bubble.hidden = true
  if (anchor) anchor.removeAttribute('aria-expanded')
  anchor = null
}

export function initHints() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest?.('.gb-hint')
    if (target) {
      event.preventDefault()
      event.stopPropagation()
      show(target)
      return
    }
    if (!event.target.closest?.('#gb-hint-bubble')) hide()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hide()
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = document.activeElement?.closest?.('.gb-hint')
    if (!target) return
    event.preventDefault()
    show(target)
  })
  // 弹窗里滚动的是内部容器，scroll 不会冒泡，所以用捕获阶段。
  document.addEventListener('scroll', () => { if (anchor) place() }, true)
  window.addEventListener('resize', () => { if (anchor) place() })
}

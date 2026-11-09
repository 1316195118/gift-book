// 统一交互反馈（原生 JS，零第三方依赖）。
// 三件事：轻量提示 toast、点击涟漪、异步按钮忙碌态。
// 所有视觉都由 motion.css 的 tokens 变量驱动，红白两套主题自动成立。

const ICONS = {
  success: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="7.6"/><path d="m6.4 10.2 2.4 2.4 4.8-4.9"/></svg>',
  info: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7.6"/><path d="M10 9v4.4M10 6.3h.01"/></svg>',
  warning: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.8 18 16.7H2L10 2.8Z"/><path d="M10 8v3.6M10 14.1h.01"/></svg>',
  error: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7.6"/><path d="m7.2 7.2 5.6 5.6M12.8 7.2l-5.6 5.6"/></svg>',
}

const MAX_VISIBLE = 3
const MOTION_KEY = 'giftbook_motion'
let stack = null
let seq = 0
const timers = new Map()

// 动效档位：system（跟随系统）/ full（始终完整）/ reduce（始终精简）。
// 系统开启「减弱动态效果」时，用户仍可显式打开完整动效；CSS 侧通过
// html.motion-full 解除降级规则，见各样式表的 :not(.motion-full) 前缀。
export function motionPreference() {
  try {
    const value = localStorage.getItem(MOTION_KEY)
    return value === 'full' || value === 'reduce' ? value : 'system'
  } catch {
    return 'system'
  }
}

function applyMotionClass() {
  document.documentElement.classList.toggle('motion-full', motionPreference() === 'full')
}

export function setMotionPreference(value) {
  const next = value === 'full' || value === 'reduce' ? value : 'system'
  try { localStorage.setItem(MOTION_KEY, next) } catch { /* 忽略 */ }
  applyMotionClass()
  return next
}

/** 两态切换：跟随系统 ↔ 始终完整。返回当前档位。 */
export function toggleMotionPreference() {
  return setMotionPreference(motionPreference() === 'full' ? 'system' : 'full')
}

export function prefersReducedMotion() {
  const pref = motionPreference()
  if (pref === 'full') return false
  if (pref === 'reduce') return true
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function ensureStack() {
  if (stack && stack.isConnected) return stack
  stack = document.createElement('div')
  stack.id = 'gb-toast-stack'
  stack.className = 'gb-toast-stack'
  stack.setAttribute('aria-live', 'polite')
  stack.addEventListener('click', (event) => {
    const close = event.target.closest('.gb-toast-close')
    if (!close) return
    const item = close.closest('.gb-toast')
    if (item) dismiss(Number(item.dataset.id))
  })
  document.body.appendChild(stack)
  return stack
}

function arm(el, id, ms) {
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => dismiss(id), ms))
}

/**
 * 轻量提示。成功/信息/警告/错误四种语气，图标只区别于形状，
 * 颜色一律取当前主题色，白事页面不会出现红金。
 */
export function notify(message, options = {}) {
  const { type = 'info', duration = 3200, detail = '' } = options
  const kind = ICONS[type] ? type : 'info'
  const host = ensureStack()
  while (host.children.length >= MAX_VISIBLE) {
    const oldest = host.firstElementChild
    const oldId = Number(oldest.dataset.id)
    clearTimeout(timers.get(oldId))
    timers.delete(oldId)
    oldest.remove()
  }

  const id = ++seq
  const el = document.createElement('div')
  el.className = `gb-toast gb-toast-${kind}`
  el.dataset.id = String(id)
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status')

  const icon = document.createElement('span')
  icon.className = 'gb-toast-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.innerHTML = ICONS[kind]

  const body = document.createElement('div')
  body.className = 'gb-toast-body'
  const title = document.createElement('b')
  title.textContent = String(message == null ? '' : message)
  body.appendChild(title)
  if (detail) {
    const sub = document.createElement('small')
    sub.textContent = String(detail)
    body.appendChild(sub)
  }

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'gb-toast-close'
  close.setAttribute('aria-label', '关闭提示')
  close.textContent = '×'

  const progress = document.createElement('span')
  progress.className = 'gb-toast-progress'
  progress.setAttribute('aria-hidden', 'true')
  progress.style.animationDuration = `${duration}ms`

  el.append(icon, body, close, progress)
  host.appendChild(el)
  arm(el, id, duration)

  // 悬停暂停自动消失，避免用户正要读就被收走。
  el.addEventListener('mouseenter', () => {
    clearTimeout(timers.get(id))
    el.classList.add('is-paused')
  })
  el.addEventListener('mouseleave', () => {
    el.classList.remove('is-paused')
    arm(el, id, 1600)
  })
  return id
}

export const success = (message, options = {}) => notify(message, { ...options, type: 'success' })
export const info = (message, options = {}) => notify(message, { ...options, type: 'info' })
export const warn = (message, options = {}) => notify(message, { ...options, type: 'warning' })
export const error = (message, options = {}) => notify(message, { ...options, type: 'error' })

export function dismiss(id) {
  const el = stack && stack.querySelector(`.gb-toast[data-id="${id}"]`)
  if (!el || el.classList.contains('is-leaving')) return
  clearTimeout(timers.get(id))
  timers.delete(id)
  el.classList.add('is-leaving')
  const done = () => el.remove()
  el.addEventListener('animationend', done, { once: true })
  // reduced-motion 下动画被关掉，animationend 不会触发，用定时器兜底。
  setTimeout(done, 240)
}

export function dismissAll() {
  Array.from(timers.keys()).forEach(dismiss)
}

/** 一次性强调：金额更新、复制完成等「值变了」的微反馈。 */
export function pulse(el) {
  if (!el || prefersReducedMotion()) return
  el.classList.remove('gb-pulse')
  void el.offsetWidth
  el.classList.add('gb-pulse')
  el.addEventListener('animationend', () => el.classList.remove('gb-pulse'), { once: true })
}

/** 异步按钮：统一处理禁用、忙碌文案、spinner 与恢复。 */
export async function withBusy(el, task, { busyText = '' } = {}) {
  if (!el) return task()
  const original = el.textContent
  const wasDisabled = Boolean(el.disabled)
  el.disabled = true
  el.classList.add('is-busy')
  el.setAttribute('aria-busy', 'true')
  if (busyText) el.textContent = busyText
  try {
    return await task()
  } finally {
    el.disabled = wasDisabled
    el.classList.remove('is-busy')
    el.removeAttribute('aria-busy')
    el.textContent = original
  }
}

// ---- 点击涟漪 ----
// 单独一层 absolute 容器负责裁剪，宿主只需要 position:relative，
// 不改宿主的 overflow（下拉菜单、金额遮罩等不会被切掉）。
const RIPPLE_TARGETS = [
  'button',
  '.btn',
  '.themed-button-primary',
  '.themed-button-secondary',
  '.home-create-btn',
  '.home-side-help',
  '.choice-card',
  '.tpl-card',
  '.recent-item',
  '.cover-style-item',
  '.export-option',
  '[role="button"]',
].join(',')

function onPointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return
  if (prefersReducedMotion()) return
  const el = event.target.closest && event.target.closest(RIPPLE_TARGETS)
  if (!el || el.disabled || el.classList.contains('gb-no-ripple')) return
  if (el.closest('.gb-toast-stack, #qr-float')) return
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return

  const size = Math.max(rect.width, rect.height) * 1.25
  const layer = document.createElement('span')
  layer.className = 'gb-ripple-layer'
  const dot = document.createElement('i')
  dot.className = 'gb-ripple-dot'
  dot.style.width = `${size}px`
  dot.style.height = `${size}px`
  dot.style.left = `${(event.clientX || rect.left + rect.width / 2) - rect.left - size / 2}px`
  dot.style.top = `${(event.clientY || rect.top + rect.height / 2) - rect.top - size / 2}px`
  layer.appendChild(dot)
  el.classList.add('gb-ripple-host')
  el.appendChild(layer)
  const drop = () => layer.remove()
  dot.addEventListener('animationend', drop, { once: true })
  setTimeout(drop, 700)
}

export function initRipple() {
  document.addEventListener('pointerdown', onPointerDown, { passive: true })
  return () => document.removeEventListener('pointerdown', onPointerDown)
}

/**
 * 红事专属的喜庆反馈：一枚淡入的喜字 + 少量金点向外散开。
 * 只在完整动效且调用方确认是红事时使用；白事、错误、删除、锁定等场景一律不调用。
 */
export function celebrate(glyph = '囍', { host = document.body } = {}) {
  if (prefersReducedMotion()) return
  const layer = document.createElement('div')
  layer.className = 'gb-celebrate'
  layer.setAttribute('aria-hidden', 'true')

  const mark = document.createElement('span')
  mark.className = 'gb-celebrate-mark'
  mark.textContent = glyph
  layer.appendChild(mark)

  for (let i = 0; i < 8; i += 1) {
    const dot = document.createElement('i')
    dot.className = 'gb-celebrate-dot'
    dot.style.setProperty('--gb-angle', `${(360 / 8) * i}deg`)
    dot.style.setProperty('--gb-delay', `${i * 28}ms`)
    layer.appendChild(dot)
  }
  host.appendChild(layer)
  setTimeout(() => layer.remove(), 1300)
}

export function initFeedback() {
  applyMotionClass()
  ensureStack()
  return initRipple()
}

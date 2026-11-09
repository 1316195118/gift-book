// 动效档位、红事喜庆反馈、点击涟漪与音效接入（Vue 3 版）。
// 系统开启「减弱动态效果」时，用户仍可显式打开完整动效；
// CSS 侧通过 html.motion-full 解除各样式表的 :not(.motion-full) 降级规则。

import { playTap, playCelebrate } from './sound.js'

const MOTION_KEY = 'giftbook_motion'

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

/** 红事专属：一枚淡入的喜字 + 8 个金点向外散开，配两声上行音阶。 */
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
  playCelebrate()
  setTimeout(() => layer.remove(), 1300)
}

// ---- 点击涟漪 + 指向反馈 ----
// 单独一层 absolute 容器负责裁剪，宿主只加 position:relative，
// 不改宿主的 overflow（下拉菜单、金额遮罩等浮层不会被切掉）。
const RIPPLE_TARGETS = [
  'button', '.btn', '.themed-button-primary', '.themed-button-secondary',
  '.home-create-btn', '.home-side-help', '.choice-card', '.tpl-card',
  '.recent-item', '.cover-style-item', '.export-option', '[role="button"]',
].join(',')

function onPointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return
  const el = event.target.closest && event.target.closest(RIPPLE_TARGETS)
  if (!el || el.disabled || el.classList.contains('gb-no-ripple')) return
  if (el.closest('#qr-float')) return
  playTap()
  if (prefersReducedMotion()) return

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
}

export function initFeedback() {
  applyMotionClass()
  initRipple()
}

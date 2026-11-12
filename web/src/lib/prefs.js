// 设备级偏好（语音、大字、打印、锁定），全部存本地，不涉及账簿数据。
const VOICE_OPTIONS_KEY = 'giftbook_voice_options.v1'
const LARGE_TEXT_KEY = 'giftbook_large_text.v1'
const PRINT_OPTIONS_KEY = 'giftbook_print_options.v1'
const CATEGORY_KEY = 'giftbook_category'

export const getHomeCategory = () =>
  localStorage.getItem(CATEGORY_KEY) === 'white' ? 'white' : 'red'

export const setHomeCategory = (cat) => {
  localStorage.setItem(CATEGORY_KEY, cat === 'white' ? 'white' : 'red')
}

export function getVoiceOptions() {
  try {
    const raw = localStorage.getItem(VOICE_OPTIONS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const rate = Number(parsed.rate)
      const volume = Number(parsed.volume)
      return {
        rate: Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1,
        volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
      }
    }
  } catch {
    /* 忽略 */
  }
  return { rate: 1, volume: 1 }
}

export function saveVoiceOptions(options) {
  try {
    localStorage.setItem(VOICE_OPTIONS_KEY, JSON.stringify(options))
  } catch {
    /* 忽略 */
  }
}

export const isLargeText = () => {
  try {
    return localStorage.getItem(LARGE_TEXT_KEY) === '1'
  } catch {
    return false
  }
}

export function saveLargeText(on) {
  try {
    localStorage.setItem(LARGE_TEXT_KEY, on ? '1' : '0')
  } catch {
    /* 忽略 */
  }
  document.documentElement.classList.toggle('large-text', on)
}

export function getPrintOptions() {
  try {
    const raw = localStorage.getItem(PRINT_OPTIONS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        fontSize: parsed.fontSize === 'large' || parsed.fontSize === 'xlarge' ? parsed.fontSize : 'normal',
        margin: parsed.margin === 'narrow' || parsed.margin === 'wide' ? parsed.margin : 'normal',
        appendix: parsed.appendix !== false,
      }
    }
  } catch {
    /* 忽略 */
  }
  return { fontSize: 'normal', margin: 'normal', appendix: true }
}

export function savePrintOptions(options) {
  try {
    localStorage.setItem(PRINT_OPTIONS_KEY, JSON.stringify(options))
  } catch {
    /* 忽略 */
  }
}

export function printOptionsScale() {
  const o = getPrintOptions()
  return o.fontSize === 'large' ? 1.12 : o.fontSize === 'xlarge' ? 1.24 : 1
}

export function printOptionsMargins() {
  const o = getPrintOptions()
  if (o.margin === 'narrow') return { x: '9mm', y: '7mm' }
  if (o.margin === 'wide') return { x: '20mm', y: '16mm' }
  return { x: '15mm', y: '12mm' }
}

export function printOptionsCss() {
  const scale = printOptionsScale()
  const m = printOptionsMargins()
  return `#print-view { --print-font-scale: ${scale}; --print-margin-x: ${m.x}; --print-margin-y: ${m.y}; }`
}

export function applyPrintOptionsToView(view) {
  if (!view) return
  const scale = printOptionsScale()
  const m = printOptionsMargins()
  view.style.setProperty('--print-font-scale', String(scale))
  view.style.setProperty('--print-margin-x', m.x)
  view.style.setProperty('--print-margin-y', m.y)
}

export const lockStorageKey = (eventId) => `giftbook_lock_${eventId || ''}`

export const readLocked = (eventId) => {
  try {
    return localStorage.getItem(lockStorageKey(eventId)) === '1'
  } catch {
    return false
  }
}

export const writeLocked = (eventId, locked) => {
  try {
    localStorage.setItem(lockStorageKey(eventId), locked ? '1' : '0')
  } catch {
    /* 隐私模式忽略 */
  }
}

export const qrStorageKey = (eventId) => `giftbook_qr_${eventId || ''}`

/* ---- 动效与音效档位：feedback.js / sound.js 共用，避免两处逻辑漂移 ---- */
const MOTION_KEY = 'giftbook_motion'
const SOUND_KEY = 'giftbook_sound'

export function motionPreference() {
  try {
    const value = localStorage.getItem(MOTION_KEY)
    return value === 'full' || value === 'reduce' ? value : 'system'
  } catch {
    return 'system'
  }
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

export function applyMotionClass() {
  document.documentElement.classList.toggle('motion-full', motionPreference() === 'full')
}

/** 提示音默认关闭，只有用户显式开启才写 'on'。 */
export function soundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) === 'on'
  } catch {
    return false
  }
}

export function setSoundEnabled(on) {
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off') } catch { /* 忽略 */ }
}

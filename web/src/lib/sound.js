// 轻量音效（Web Audio API 合成，零外部音频资源）。
// 三种声音对应三种动作：点击「嗒」、落印「咚」、红事建簿「叮咚」。
// 浏览器要求用户交互后才能起 AudioContext，所以这里是懒创建 + 自动 resume。
// 白事只用低沉的素音，绝不播放喜庆音阶；减动效/关闭音效时完全静音。

// 不 import feedback.js，避免循环依赖；这里只读同一份档位与系统偏好。
function quietByMotion() {
  try {
    const pref = localStorage.getItem('giftbook_motion')
    if (pref === 'full') return false
    if (pref === 'reduce') return true
  } catch { /* 忽略 */ }
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const SOUND_KEY = 'giftbook_sound'
let ctx = null

export function soundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSoundEnabled(on) {
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off') } catch { /* 忽略 */ }
}

function audio() {
  if (!soundEnabled() || quietByMotion()) return null
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext
    if (!Ctor) return null
    if (!ctx) ctx = new Ctor()
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  } catch {
    // 某些无头/受限浏览器禁用 Web Audio：静默降级，绝不影响记账。
    return null
  }
}

/** 单个音：可带频率滑音与延迟，音量始终压得很低，不打扰记账。 */
function tone(ac, { freq, dur = 0.12, type = 'sine', gain = 0.05, delay = 0, endFreq = 0 }) {
  const t0 = ac.currentTime + delay
  const osc = ac.createOscillator()
  const amp = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur)
  amp.gain.setValueAtTime(0.0001, t0)
  amp.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.015, dur / 4))
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(amp).connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

/** 点击：一声极轻的短促高音，配合涟漪给出「接到了」的确认。 */
export function playTap() {
  const ac = audio()
  if (ac) tone(ac, { freq: 880, dur: 0.055, type: 'triangle', gain: 0.022 })
}

/** 落印：印章压在纸上的一声闷响；白事改用更低更素的音。 */
export function playStamp(solemn = false) {
  const ac = audio()
  if (!ac) return
  tone(ac, { freq: solemn ? 150 : 210, dur: 0.16, type: 'sine', gain: 0.07, endFreq: solemn ? 90 : 120 })
  tone(ac, { freq: solemn ? 300 : 420, dur: 0.07, type: 'triangle', gain: 0.025, delay: 0.01 })
}

/** 红事建簿：两声上行的清亮音阶。只在 celebrate() 里调用，白事永不触发。 */
export function playCelebrate() {
  const ac = audio()
  if (!ac) return
  tone(ac, { freq: 784, dur: 0.18, type: 'sine', gain: 0.05 })
  tone(ac, { freq: 1046, dur: 0.28, type: 'sine', gain: 0.045, delay: 0.12 })
  tone(ac, { freq: 1568, dur: 0.3, type: 'sine', gain: 0.025, delay: 0.24 })
}

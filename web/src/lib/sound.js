// 轻量音效（Web Audio API 合成，零外部音频资源）。
// 浏览器要求用户交互后才能起 AudioContext，所以懒创建 + 自动 resume。
// 提示音默认关闭；白事只用低沉素音，绝不播放喜庆音阶；减动效时完全静音。

import { prefersReducedMotion, soundEnabled } from './prefs.js'

export { soundEnabled, setSoundEnabled } from './prefs.js'

let ctx = null

function audio() {
  if (!soundEnabled() || prefersReducedMotion()) return null
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext
    if (!Ctor) return null
    if (!ctx) ctx = new Ctor()
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

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

/** 点击：一声极轻的短促高音。 */
export function playTap() {
  const ac = audio()
  if (ac) tone(ac, { freq: 880, dur: 0.055, type: 'triangle', gain: 0.022 })
}

/** 落印：印章压在纸上的闷响；白事更低更素。 */
export function playStamp(solemn = false) {
  const ac = audio()
  if (!ac) return
  tone(ac, { freq: solemn ? 150 : 210, dur: 0.16, type: 'sine', gain: 0.07, endFreq: solemn ? 90 : 120 })
  tone(ac, { freq: solemn ? 300 : 420, dur: 0.07, type: 'triangle', gain: 0.025, delay: 0.01 })
}

/** 红事建簿：上行清亮音阶。只在 celebrate() 里调用，白事永不触发。 */
export function playCelebrate() {
  const ac = audio()
  if (!ac) return
  tone(ac, { freq: 784, dur: 0.18, type: 'sine', gain: 0.05 })
  tone(ac, { freq: 1046, dur: 0.28, type: 'sine', gain: 0.045, delay: 0.12 })
  tone(ac, { freq: 1568, dur: 0.3, type: 'sine', gain: 0.025, delay: 0.24 })
}

/** 成功类操作（保存、导入、导出完成）：一声干净的短音。 */
export function playSuccess() {
  const ac = audio()
  if (!ac) return
  tone(ac, { freq: 659, dur: 0.11, type: 'sine', gain: 0.032 })
  tone(ac, { freq: 988, dur: 0.16, type: 'sine', gain: 0.028, delay: 0.085 })
}

/** 警告/校验失败：一声低沉的短音，不刺耳。 */
export function playError() {
  const ac = audio()
  if (ac) tone(ac, { freq: 220, dur: 0.16, type: 'sine', gain: 0.035, endFreq: 165 })
}

/** 礼簿翻页：纸张擦过的一声极轻噪声感（用短滑音模拟）。 */
export function playPage(direction = 1) {
  const ac = audio()
  if (!ac) return
  tone(ac, { freq: direction > 0 ? 420 : 360, dur: 0.07, type: 'triangle', gain: 0.018,
    endFreq: direction > 0 ? 300 : 460 })
}

/** 主题切换：红事略亮、白事更沉，绝不使用喜庆音阶。 */
export function playTheme(solemn = false) {
  const ac = audio()
  if (ac) tone(ac, { freq: solemn ? 196 : 392, dur: 0.14, type: 'sine', gain: 0.026 })
}

/** 白事确认：一声克制的素音，配合素银淡墨反馈。 */
export function playSolemn() {
  const ac = audio()
  if (!ac) return
  tone(ac, { freq: 174, dur: 0.24, type: 'sine', gain: 0.03 })
  tone(ac, { freq: 261, dur: 0.2, type: 'sine', gain: 0.018, delay: 0.1 })
}

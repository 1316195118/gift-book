// 家庭级偏好同步：把界面偏好存到服务端，同一家庭的所有设备共享。
// localStorage 仍作为离线缓存；服务端是「权威副本」，登录后覆盖本机。
// 设备级数据（离线缓存、待补传、操作员、提示已读）不在此同步。
import { state as st } from '../store.js'
import { api } from './api.js'

let syncTimer = 0
let pulling = false
let applying = false

// 拉取后写回本机时会调用各 save 函数并派发事件，此标志避免回写循环。

function familyId() {
  return st.family?.id || ''
}

// 读取当前本机偏好，组装成服务端 bundle。
async function collect() {
  const p = await import('./prefs.js')
  return {
    enabledCategories: p.getEnabledCategories(),
    homeCategory: st.homeCategory,
    largeText: p.isLargeText(),
    motion: p.motionPreference(),
    sound: p.soundEnabled(),
    voiceRate: p.getVoiceOptions().rate,
    voiceVolume: p.getVoiceOptions().volume,
    print: p.getPrintOptions(),
  }
}

// 把服务端偏好写回本机。只覆盖偏好，不动设备级数据。
async function apply(prefs) {
  if (!prefs || typeof prefs !== 'object') return
  const p = await import('./prefs.js')
  if (Array.isArray(prefs.enabledCategories)) {
    p.saveEnabledCategories(prefs.enabledCategories)
    st.enabledCategories = p.getEnabledCategories()
  }
  if (typeof prefs.homeCategory === 'string') {
    p.setHomeCategory(prefs.homeCategory)
    st.homeCategory = prefs.homeCategory
  }
  if (typeof prefs.largeText === 'boolean') p.saveLargeText(prefs.largeText)
  if (['system', 'full', 'reduce'].includes(prefs.motion)) p.setMotionPreference(prefs.motion)
  if (typeof prefs.sound === 'boolean') p.setSoundEnabled(prefs.sound)
  if (typeof prefs.voiceRate === 'number' || typeof prefs.voiceVolume === 'number') {
    const cur = p.getVoiceOptions()
    p.saveVoiceOptions({
      rate: typeof prefs.voiceRate === 'number' ? prefs.voiceRate : cur.rate,
      volume: typeof prefs.voiceVolume === 'number' ? prefs.voiceVolume : cur.volume,
    })
  }
  if (prefs.print && typeof prefs.print === 'object') {
    p.savePrintOptions({
      fontSize: prefs.print.fontSize || 'normal',
      margin: prefs.print.margin || 'normal',
      appendix: prefs.print.appendix !== false,
    })
  }
}

/** 登录后拉取家庭偏好覆盖本机；失败时保留本机缓存，不影响使用。 */
export async function pullFamilyPrefs() {
  if (!familyId() || pulling) return
  pulling = true
  applying = true
  try {
    const result = await api.familyPreferences()
    if (result.data && Object.keys(result.data).length > 0) {
      await apply(result.data)
    } else {
      // 服务端还没有偏好：以本机为准，主动上传一次作为初始副本。
      const prefs = await collect()
      await api.saveFamilyPreferences(prefs)
    }
  } catch {
    // 离线或服务端无此接口：保持本机偏好。
  } finally {
    applying = false
    pulling = false
  }
}

/** 本地偏好变更后调用：防抖写回服务端。 */
export function scheduleFamilyPrefsSync() {
  if (!familyId()) return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(async () => {
    if (!familyId() || pulling) return
    try {
      const prefs = await collect()
      await api.saveFamilyPreferences(prefs)
    } catch {
      // 同步失败不影响本机使用；下次变更会重试。
    }
  }, 400)
}

// prefs.js 通过事件通知偏好变更，避免模块间循环依赖。
if (typeof window !== 'undefined') {
  window.addEventListener('gb-prefs-changed', () => { if (!applying) scheduleFamilyPrefsSync() })
}

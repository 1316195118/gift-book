// 语音播报与音色下拉：沿用旧版目录与筛选规则。
import { LedgerVoiceCatalog } from './crypto.js'
import { getVoiceOptions } from './prefs.js'

const VOICE_CACHE_KEY = 'ledgerVoiceCache.v1'
export const VOICE_MANIFEST = LedgerVoiceCatalog?.list || []
export const VOICE_DIALECTS = LedgerVoiceCatalog?.dialects || ['川话', '渝话', '西南官话']

export function describeVoice(voice) {
  const raw = String(voice.name || '')
  const lang = String(voice.lang || '')
  const hit = LedgerVoiceCatalog?.lookup({ name: raw, lang }) || null
  if (hit) {
    return { id: hit.id, name: hit.name, tone: hit.tone, region: hit.region, gentle: Boolean(hit.gentle), rank: hit.rank }
  }
  const chineseName = raw.replace(/^Microsoft\s+/i, '').replace(/\s*-\s*Chinese.*$/i, '').trim()
  const looksChinese = /[一-龥]/.test(chineseName)
  const langKey = String(lang).toLowerCase()
  return {
    id: 'sys-' + raw,
    name: looksChinese
      ? chineseName
      : `${langKey.startsWith('zh-hk') ? '粤语' : langKey.startsWith('zh-tw') ? '台湾' : '中文'}音色`,
    tone: lang || '未知语种',
    region: '通用',
    gentle: false,
    rank: 900,
  }
}

export function detectedChineseVoices() {
  if (!('speechSynthesis' in window)) return []
  try {
    return (speechSynthesis.getVoices() || []).filter((v) => String(v.lang || '').toLowerCase().startsWith('zh'))
  } catch {
    return []
  }
}

function readVoiceCache() {
  try {
    const list = JSON.parse(localStorage.getItem(VOICE_CACHE_KEY) || '[]')
    return Array.isArray(list) ? list.filter((v) => v && v.name) : []
  } catch {
    return []
  }
}

function writeVoiceCache(voices) {
  try {
    const slim = voices.map((v) => ({ name: v.name, lang: v.lang }))
    localStorage.setItem(VOICE_CACHE_KEY, JSON.stringify(slim.slice(0, 60)))
  } catch {
    /* 隐私模式忽略 */
  }
}

const preferVoice = (candidate, current) => {
  const score = (name) => (/natural|online/i.test(name) ? 2 : 1)
  return score(candidate) > score(current)
}

// 返回下拉框的分组数据，供 Vue 渲染。
export function buildVoiceGroups(_selectedValue) {
  const live = detectedChineseVoices()
  if (live.length) writeVoiceCache(live)

  const byId = new Map()
  live.forEach((voice) => {
    const info = describeVoice(voice)
    const prev = byId.get(info.id)
    if (!prev || preferVoice(voice.name, prev.value)) byId.set(info.id, { value: voice.name, info })
  })
  const usable = [...byId.values()].sort((a, b) => {
    if (a.info.gentle !== b.info.gentle) return a.info.gentle ? -1 : 1
    return a.info.rank - b.info.rank
  })
  const missing = VOICE_MANIFEST.filter((item) => !byId.has(item.id))
  const missingRegions = missing.filter((item) => item.region !== '通用')
  const missingGeneric = missing.filter((item) => item.region === '通用')

  const groups = [
    {
      label: usable.length ? `本机可用 ${usable.length} 个` : '本机暂未返回音色（可先选下面的清单）',
      options: usable.map(({ value, info }) => ({ value, label: `${info.name} · ${info.tone}`, pending: false })),
    },
  ]
  if (missingRegions.length) {
    groups.push({
      label: `普通话与各地方言 · 男女各一（${missingRegions.length}）`,
      options: missingRegions.map((item) => ({ value: item.name, label: `${item.name} · ${item.tone}（待安装）`, pending: true })),
    })
  }
  if (missingGeneric.length) {
    groups.push({
      label: `通用音色 · 待安装（${missingGeneric.length}）`,
      options: missingGeneric.map((item) => ({ value: item.name, label: `${item.name} · ${item.tone}（待安装）`, pending: true })),
    })
  }
  return { groups, usable }
}

export function voiceHint(usable) {
  const regionCount = LedgerVoiceCatalog?.regions.length || 0
  const dialects = usable
    .filter((item) => VOICE_DIALECTS.includes(item.info.region))
    .map((item) => item.info.name)
  return `内置 ${VOICE_MANIFEST.length} 个音色（普通话 + ${regionCount - 1} 个地区，男女各一），本机可用 ${usable.length} 个${
    dialects.length
      ? `，含方言：${dialects.join('、')}`
      : '；方言音色选中后需系统装有对应语音包，否则用默认发音'
  }`
}

export function pendingVoiceHint(option) {
  return `「${String(option.label).replace('（待安装）', '')}」本机尚未安装，先用默认发音代替；在系统里装好该语音包后自动生效。`
}

export function speakText(text, voiceName) {
  if (!('speechSynthesis' in window)) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'zh-CN'
  const options = getVoiceOptions()
  utterance.rate = options.rate
  utterance.volume = options.volume
  if (voiceName) {
    const voices = speechSynthesis.getVoices()
    const selected = voices.find((voice) => voice.name === voiceName)
    if (selected) utterance.voice = selected
  }
  speechSynthesis.speak(utterance)
}

export function previewVoice(voiceName, sample) {
  if (!('speechSynthesis' in window)) return false
  speechSynthesis.cancel()
  speakText(sample, voiceName)
  return true
}

export { readVoiceCache }

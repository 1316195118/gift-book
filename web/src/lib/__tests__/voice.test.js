import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveVoice, speakText } from '../voice.js'

const voices = [
  { name: 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)', lang: 'zh-CN' },
  { name: 'Microsoft Yunxi Online (Natural) - Chinese (Mainland)', lang: 'zh-CN' },
  { name: 'Microsoft Kangkang - Chinese (Simplified, PRC)', lang: 'zh-CN' },
]

describe('音色解析', () => {
  beforeAll(() => {
    globalThis.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text
      }
    }
  })

  beforeEach(() => {
    globalThis.speechSynthesis = {
      getVoices: vi.fn(() => voices),
      cancel: vi.fn(),
      speak: vi.fn(),
    }
  })

  it('按系统完整名称精确选择男声', () => {
    const match = resolveVoice('Microsoft Yunxi Online (Natural) - Chinese (Mainland)')
    expect(match.status).toBe('ready')
    expect(match.voice.name).toContain('Yunxi')
  })

  it('兼容目录显示名与系统完整名称', () => {
    expect(resolveVoice('云希').voice?.name).toContain('Yunxi')
    expect(resolveVoice('康康').voice?.name).toContain('Kangkang')
  })

  it('男声未安装时明确返回缺失，不退回其他音色', () => {
    globalThis.speechSynthesis.getVoices.mockReturnValue([voices[0]])
    const match = resolveVoice('云希')
    expect(match.status).toBe('missing')
    expect(match.voice).toBeNull()
    expect(match.message).toContain('不会用其他音色代替')
  })

  it('未知音色不会静默使用默认声线', () => {
    const match = resolveVoice('不存在的音色')
    expect(match.status).toBe('missing')
    expect(match.voice).toBeNull()
  })

  it('指定音色缺失时不发起播报', () => {
    globalThis.speechSynthesis.getVoices.mockReturnValue([voices[0]])
    expect(speakText('测试', '云希')).toBe(false)
    expect(globalThis.speechSynthesis.speak).not.toHaveBeenCalled()
  })
})

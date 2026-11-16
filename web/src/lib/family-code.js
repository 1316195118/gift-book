// 家庭访问码强度：与服务端 familyCodeProblem 用同一套硬规则，
// 前端只负责提前提示，最终仍以服务端校验为准。
const WEAK_CODES = new Set([
  'password', 'passw0rd', '12345678', '123456789', '1234567890', '87654321',
  'qwerty123', 'qwertyui', 'abc12345', 'admin123', 'giftbook', 'woaini1314',
  '5201314520', 'a1234567', '11111111', '88888888',
])

// familyCodeProblem 返回不合规的原因，空字符串表示可用（空码 = 开放家庭）。
export function familyCodeProblem(code) {
  const value = String(code || '')
  if (!value) return ''
  const chars = [...value]
  if (chars.length < 8) return '家庭访问码至少 8 位'
  if (chars.length > 128) return '家庭访问码不能超过 128 位'
  if (chars.every((char) => char === chars[0])) return '访问码不能是同一个字符重复，请换一个'
  const step = chars[1].codePointAt(0) - chars[0].codePointAt(0)
  if (step === 1 || step === -1) {
    let sequential = true
    for (let i = 2; i < chars.length; i += 1) {
      if (chars[i].codePointAt(0) - chars[i - 1].codePointAt(0) !== step) {
        sequential = false
        break
      }
    }
    if (sequential) return '访问码不能是连续的数字或字母，请换一个'
  }
  if (chars.length % 2 === 0) {
    const half = chars.length / 2
    if (chars.slice(0, half).join('') === chars.slice(half).join('')) {
      return '访问码不能是重复的两段，请换一个'
    }
  }
  if (WEAK_CODES.has(value.toLowerCase())) return '这个访问码太常见，请换一个'
  return ''
}

// familyCodeHint 给出「弱 / 一般 / 强」的即时提示，不拦截输入。
export function familyCodeHint(code) {
  const value = String(code || '').trim()
  if (!value) return { level: '', text: '' }
  const problem = familyCodeProblem(value)
  if (problem) return { level: 'weak', text: problem }
  let score = 0
  if (/[a-z]/.test(value)) score += 1
  if (/[A-Z]/.test(value)) score += 1
  if (/\d/.test(value)) score += 1
  if (/[^A-Za-z0-9]/.test(value)) score += 1
  if ([...value].length >= 12) score += 1
  if (score >= 4) return { level: 'strong', text: '强度不错' }
  if (score >= 2) return { level: 'ok', text: '强度一般，再加长一些或混用字母数字会更好' }
  return { level: 'weak', text: '太简单，建议字母加数字' }
}

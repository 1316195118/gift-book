// 礼簿加密层：完全复用旧项目自研实现（OpenSSL 兼容格式 + v2 PBKDF2/HMAC），
// 只把旧文件的 IIFE 挂载方式改成 ES Module 导出，算法一字未动，确保历史密文可直接解开。
import './ledger-crypto.js'
import './xlsx-lite.js'
import './voices.js'
import './ocr-scan.js'

export const LedgerCrypto = globalThis.LedgerCrypto
export const XlsxLite = globalThis.XlsxLite
export const LedgerVoiceCatalog = globalThis.LedgerVoiceCatalog
export const GiftBookScan = globalThis.GiftBookScan

export const NO_PASSWORD_KEY = 'giftbook-local-nopass'
export const NO_PASSWORD_HASH = LedgerCrypto.sha256('')

export const hashPassword = (password) => LedgerCrypto.sha256(password)

export const ledgerKeyFor = (password) =>
  !password || password === NO_PASSWORD_KEY ? NO_PASSWORD_HASH : hashPassword(password)

export const newRequestId = () => {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID()
    }
  } catch {
    /* 局域网 http 下可能不可用 */
  }
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export const amountToChinese = (n) => {
  if (typeof n !== 'number' && typeof n !== 'string') return ''
  n = parseFloat(n)
  if (isNaN(n)) return ''
  if (n === 0) return '零元整'
  let unit = '京亿万仟佰拾兆万仟佰拾亿仟佰拾万仟佰拾元角分'
  let str = ''
  let s = n.toString()
  if (s.indexOf('.') > -1) s = (n * 100).toFixed(0)
  else s += '00'
  if (s.length > unit.length) return '金额过大'
  unit = unit.substr(unit.length - s.length)
  for (let i = 0; i < s.length; i++) str += '零壹贰叁肆伍陆柒捌玖'.charAt(s.charAt(i)) + unit.charAt(i)
  return str
    .replace(/零(仟|佰|拾|角)/g, '零')
    .replace(/(零)+/g, '零')
    .replace(/零(兆|万|亿|元)/g, '$1')
    .replace(/(兆|亿)万/g, '$1')
    .replace(/(京|兆)亿/g, '$1')
    .replace(/(京)兆/g, '$1')
    .replace(/(亿)万/g, '$1')
    .replace(/(京|兆|亿|仟|佰|拾)(万?)(.)/g, '$1$2$3')
    .replace(/零元/g, '元')
    .replace(/零分/g, '')
    .replace(/零角/g, '零')
    .replace(/元$/g, '元整')
    .replace(/角$/g, '角整')
}

export const formatCurrency = (amount) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount || 0)

export const escapeHtml = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const formatDateTime = (value) => (value ? new Date(value).toLocaleString('zh-CN') : '')
export const formatDate = (value) => (value ? new Date(value).toLocaleDateString('zh-CN') : '')

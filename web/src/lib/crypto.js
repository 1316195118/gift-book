// 礼簿加密层：完全复用旧项目自研实现（OpenSSL 兼容格式 + v2 PBKDF2/HMAC），
// 只把旧文件的 IIFE 挂载方式改成 ES Module 导出，算法一字未动，确保历史密文可直接解开。
import './ledger-crypto.js'

export const LedgerCrypto = globalThis.LedgerCrypto
// 大量旧模块仍从这里取格式化工具。这里只 re-export，不引入 Excel/语音/OCR。
export {
  newRequestId,
  amountToChinese,
  formatCurrency,
  escapeHtml,
  safeFileName,
  formatDateTime,
  formatDate,
} from './format.js'

export const NO_PASSWORD_KEY = 'giftbook-local-nopass'
export const NO_PASSWORD_HASH = LedgerCrypto.sha256('')

export const hashPassword = (password) => LedgerCrypto.sha256(password)

export const ledgerKeyFor = (password) =>
  !password || password === NO_PASSWORD_KEY ? NO_PASSWORD_HASH : hashPassword(password)

// 姓名哈希：服务端只能比对、不能还原姓名，用于「10 分钟内同名」近邻提醒。
export async function sha256Hex(text) {
  try {
    if (crypto?.subtle) {
      const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)))
      return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    /* 不支持的浏览器不启用近邻提醒 */
  }
  return ''
}

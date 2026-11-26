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
  const value = String(text)
  try {
    if (globalThis.crypto?.subtle) {
      const buffer = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
      return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    /* Web Crypto 不可用时走下面的同步实现 */
  }
  // 局域网 HTTP 不是安全上下文，crypto.subtle 会缺失。项目已有纯 JS SHA-256，
  // 这里必须回退，否则同名近邻提醒会在手机直连内网地址时静默失效。
  return LedgerCrypto.sha256(value)
}

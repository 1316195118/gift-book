import { createCipheriv, createDecipheriv, createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import '../ledger-crypto.js'

const crypto = globalThis.LedgerCrypto

function evpBytesToKey(passphrase, salt, length = 48) {
  const password = Buffer.from(String(passphrase), 'utf8')
  const chunks = []
  let previous = Buffer.alloc(0)
  let total = 0
  while (total < length) {
    previous = createHash('md5').update(Buffer.concat([previous, password, salt])).digest()
    chunks.push(previous)
    total += previous.length
  }
  return Buffer.concat(chunks).subarray(0, length)
}

function parseLegacy(cipherText) {
  const raw = Buffer.from(cipherText, 'base64')
  expect(raw.subarray(0, 8).toString()).toBe('Salted__')
  return { salt: raw.subarray(8, 16), cipherText: raw.subarray(16) }
}

function nodeEncryptLegacy(text, passphrase, salt) {
  const keyIv = evpBytesToKey(passphrase, salt)
  const cipher = createCipheriv('aes-256-cbc', keyIv.subarray(0, 32), keyIv.subarray(32, 48))
  return Buffer.concat([Buffer.from('Salted__'), salt, cipher.update(text, 'utf8'), cipher.final()]).toString('base64')
}

function nodeDecryptLegacy(cipherText, passphrase) {
  const { salt, cipherText: body } = parseLegacy(cipherText)
  const keyIv = evpBytesToKey(passphrase, salt)
  const decipher = createDecipheriv('aes-256-cbc', keyIv.subarray(0, 32), keyIv.subarray(32, 48))
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

function parseV2(cipherText) {
  const raw = Buffer.from(cipherText, 'base64')
  expect(raw.subarray(0, 4).toString()).toBe('GBv2')
  return {
    body: raw.subarray(0, raw.length - 32),
    tag: raw.subarray(raw.length - 32),
    iv: raw.subarray(4, 20),
    cipherText: raw.subarray(20, raw.length - 32),
  }
}

function nodeDecryptV2(cipherText, keys) {
  const { body, tag, iv, cipherText: payload } = parseV2(cipherText)
  const expected = createHmac('sha256', keys.mac).update(body).digest()
  expect(tag.equals(expected)).toBe(true)
  const decipher = createDecipheriv('aes-256-cbc', keys.enc, iv)
  return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8')
}

function nodeEncryptV2(text, keys) {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', keys.enc, iv)
  const payload = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const body = Buffer.concat([Buffer.from('GBv2'), iv, payload])
  const tag = createHmac('sha256', keys.mac).update(body).digest()
  return Buffer.concat([body, tag]).toString('base64')
}

describe('ledger crypto interoperability', () => {
  it('writes and reads the legacy OpenSSL-compatible format with Node crypto', () => {
    const text = '张三 · 贺礼 208.50 元\n李四 · 奠仪 10 元\n🙏'
    const passphrase = '账簿密码 · 2026'
    const fromBrowser = crypto.encrypt(text, passphrase)
    expect(nodeDecryptLegacy(fromBrowser, passphrase)).toBe(text)

    const salt = Buffer.from('1020304050607080', 'hex')
    const fromNode = nodeEncryptLegacy(text, passphrase, salt)
    expect(crypto.decrypt(fromNode, passphrase)).toBe(text)
  })

  it('derives PBKDF2 and HMAC keys identically to Node crypto', () => {
    const passphrase = 'correct horse battery staple'
    const params = crypto.newKdfParams(100000)
    const keys = crypto.deriveKeys(passphrase, params)
    const salt = Buffer.from(params.salt, 'base64')
    const master = pbkdf2Sync(passphrase, salt, params.iter, 32, 'sha256')

    expect(Buffer.from(keys.enc).equals(createHmac('sha256', master).update('giftbook-v2-enc').digest())).toBe(true)
    expect(Buffer.from(keys.mac).equals(createHmac('sha256', master).update('giftbook-v2-mac').digest())).toBe(true)
  })

  it('reads and writes authenticated v2 records with Node crypto', () => {
    const text = '来宾：王五\n金额：10.00\n备注：同事，小额现金'
    const params = crypto.newKdfParams(100000)
    const keys = crypto.deriveKeys('v2 password', params)

    expect(nodeDecryptV2(crypto.encrypt(text, keys), keys)).toBe(text)
    expect(crypto.decrypt(nodeEncryptV2(text, keys), keys)).toBe(text)
  })
})

// 并发压力测试：并发写入、并发读取、人数计数一致性和响应分位数。
// 用法：先启动隔离实例，再 BASE=http://127.0.0.1:18099 node scripts/stress.mjs
import assert from 'node:assert'
import { createHash } from 'node:crypto'

const BASE = process.env.BASE || 'http://127.0.0.1:18099'
const WRITES = Number(process.env.STRESS_WRITES || 200)
const READS = Number(process.env.STRESS_READS || 100)
const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const noPass = sha256('')

async function call(path, { method = 'GET', body } = {}) {
  const started = performance.now()
  const response = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = { raw: text }
  }
  return { status: response.status, payload, ms: performance.now() - started }
}

function fakeCipher(seed) {
  const body = Buffer.concat([
    Buffer.from('GBv2'),
    Buffer.from(seed.padEnd(16, '0').slice(0, 16)),
    Buffer.alloc(48, 7),
  ])
  return body.toString('base64')
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]
}

const suffix = Date.now().toString(36)
const created = await call('/api/events', {
  method: 'POST',
  body: {
    name: `并发压力 ${suffix}`,
    passwordHash: noPass,
    template: '婚宴',
    category: 'red',
    startDateTime: '2026-11-20T08:00',
    endDateTime: '2026-11-22T23:59',
  },
})
assert.equal(created.status, 200, JSON.stringify(created.payload))
const eventId = created.payload.data.id

try {
  const writes = await Promise.all(
    Array.from({ length: WRITES }, (_, index) => call('/api/gifts', {
      method: 'POST',
      body: {
        eventId,
        encryptedContent: fakeCipher(`${suffix}-${index}`),
        requestId: `stress-${suffix}-${index}`,
      },
    })),
  )
  assert.ok(writes.every((item) => item.status === 200), '并发写入存在失败')

  const all = await call(`/api/gifts?eventId=${eventId}`)
  assert.equal(all.status, 200)
  assert.equal(Object.keys(all.payload.data).length, WRITES, '并发写入后礼金数量不一致')

  const reads = await Promise.all([
    ...Array.from({ length: READS }, () => call('/api/gifts?eventId=' + eventId)),
    ...Array.from({ length: READS }, () => call('/api/events')),
  ])
  assert.ok(reads.every((item) => item.status === 200), '并发读取存在失败')
  assert.ok(
    reads.slice(0, READS).every((item) => Object.keys(item.payload.data).length === WRITES),
    '并发读取返回了不完整快照',
  )
  assert.ok(
    reads.slice(READS).every((item) => Number(item.payload.data?.[eventId]?.giftCount) === WRITES),
    '并发读取的人数计数不一致',
  )

  const writeLatency = writes.map((item) => item.ms)
  const readLatency = reads.map((item) => item.ms)
  console.log(JSON.stringify({
    eventId,
    writes: WRITES,
    concurrentReads: READS * 2,
    writeMs: {
      p50: percentile(writeLatency, 0.5).toFixed(1),
      p95: percentile(writeLatency, 0.95).toFixed(1),
      max: Math.max(...writeLatency).toFixed(1),
    },
    readMs: {
      p50: percentile(readLatency, 0.5).toFixed(1),
      p95: percentile(readLatency, 0.95).toFixed(1),
      max: Math.max(...readLatency).toFixed(1),
    },
  }, null, 2))
  console.log('并发压力测试通过')
} finally {
  await call(`/api/events/${eventId}`, { method: 'DELETE' })
}

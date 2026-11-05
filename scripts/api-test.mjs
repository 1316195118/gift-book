// 端到端接口测试：建账 → 写入密文礼金 → 校验 → 修改留痕 → 备份 → 恢复。
import assert from 'node:assert'

const BASE = process.env.BASE || 'http://127.0.0.1:18099'

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text }
  }
  return { status: res.status, data }
}

import { createHash } from 'node:crypto'
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

// 与前端 v2 格式一致的最小实现：GBv2 + IV + 密文 + MAC 的校验只要格式正确即可被服务端接受，
// 内容由浏览器加解密，这里用固定长度的假密文验证服务端存取链路。
const fakeCipher = (seed) => {
  const body = Buffer.concat([Buffer.from('GBv2'), Buffer.from(seed.padEnd(16, '0').slice(0, 16)), Buffer.alloc(48, 7)])
  return body.toString('base64')
}

const noPass = sha256('')

async function main() {
  const suffix = Date.now().toString(36)

  // 1. 无密码账簿
  const created = await call('/api/events', {
    method: 'POST',
    body: { name: '测试账簿 ' + suffix, passwordHash: noPass, theme: 'theme-festive', category: 'red', startDateTime: '2026-11-04T10:00', endDateTime: '2026-11-05T22:00', location: '测试厅', template: '婚宴', coverStyle: 'shuangxi', totalAmount: 0 },
  })
  assert.equal(created.status, 200, 'create event')
  assert.equal(created.data.success, true)
  const eventId = created.data.data.id
  assert.equal(created.data.data.hasPassword, false)
  assert.match(created.data.data.displayId, /^\d{3}$/)
  assert.ok(!('ledgerVerifier' in created.data.data), '不返回校验材料')
  console.log('✓ 创建无密码账簿', eventId, created.data.data.displayId)

  // 2. 写入礼金
  const c1 = fakeCipher('a'.repeat(16))
  const gift = await call('/api/gifts', { method: 'POST', body: { eventId, encryptedContent: c1, requestId: 'req-' + suffix + '-1' } })
  assert.equal(gift.status, 200, 'create gift: ' + JSON.stringify(gift.data))
  const giftId = gift.data.data.id
  assert.equal(gift.data.data.encryptedContent, c1)

  // 3. 幂等：同一 requestId 不重复落库
  const dup = await call('/api/gifts', { method: 'POST', body: { eventId, encryptedContent: c1, requestId: 'req-' + suffix + '-1' } })
  assert.equal(dup.data.duplicate, true, 'duplicate requestId')
  console.log('✓ 礼金写入与 requestId 去重')

  // 4. 列表与人数
  const list = await call('/api/gifts?eventId=' + eventId)
  assert.equal(Object.keys(list.data.data).length, 1)
  const events = await call('/api/events')
  assert.equal(events.data.data[eventId].giftCount, 1)

  // 5. 修改（带 ifMatch 乐观锁）
  const c2 = fakeCipher('b'.repeat(16))
  const badMatch = await call(`/api/gifts/${giftId}?eventId=${eventId}`, { method: 'PUT', body: { eventId, encryptedContent: c2, ifMatch: sha256('wrong') } })
  assert.equal(badMatch.status, 409, 'ifMatch mismatch')
  const good = await call(`/api/gifts/${giftId}?eventId=${eventId}`, { method: 'PUT', body: { eventId, encryptedContent: c2, ifMatch: sha256(c1) } })
  assert.equal(good.status, 200, 'update gift')
  console.log('✓ 修改与并发保护')

  // 6. 账簿统计字段更新
  const upd = await call('/api/events/' + eventId, { method: 'PUT', body: { totalAmount: 1288.5, note: '测试备注' } })
  assert.equal(upd.status, 200)
  assert.equal(upd.data.data.totalAmount, 1288.5)

  // 7. 有密码账簿与钥匙校验
  const key = sha256('secret-password')
  const locked = await call('/api/events', { method: 'POST', body: { name: '有密码账簿 ' + suffix, passwordHash: key, template: '丧事', theme: 'theme-solemn' } })
  const lockedId = locked.data.data.id
  assert.equal(locked.data.data.hasPassword, true)
  const denied = await call('/api/gifts?eventId=' + lockedId)
  assert.equal(denied.status, 403, 'no key denied')
  assert.equal(denied.data.code, 'ledger_key')
  const wrong = await call('/api/gifts?eventId=' + lockedId, { headers: { 'X-Ledger-Key': sha256('nope') } })
  assert.equal(wrong.status, 403)
  const allowed = await call('/api/gifts?eventId=' + lockedId, { headers: { 'X-Ledger-Key': key } })
  assert.equal(allowed.status, 200, 'correct key allowed: ' + JSON.stringify(allowed.data))
  const verify = await call(`/api/events/${lockedId}/verify`, { method: 'POST', body: { action: 'verify' }, headers: { 'X-Ledger-Key': key } })
  assert.equal(verify.status, 200)
  console.log('✓ 管理密码校验与错误计数')

  // 8. 备份导出
  const backup = await fetch(BASE + '/api/backup')
  assert.equal(backup.status, 200)
  const buf = Buffer.from(await backup.arrayBuffer())
  assert.ok(buf.length > 100, 'backup size')
  console.log('✓ 备份导出', buf.length, 'bytes')

  // 9. 恢复导入
  const form = new FormData()
  form.append('file', new Blob([buf], { type: 'application/zip' }), 'backup.zip')
  const restore = await fetch(BASE + '/api/backup/restore', { method: 'POST', body: form })
  const restored = await restore.json()
  assert.equal(restore.status, 200, JSON.stringify(restored))
  assert.equal(restored.data.events, 2)
  const after = await call('/api/gifts?eventId=' + eventId)
  assert.equal(Object.keys(after.data.data).length, 1)
  assert.equal(after.data.data[giftId].encryptedContent, c2)
  console.log('✓ 备份恢复', JSON.stringify(restored.data))

  // 10. 非法输入
  const bad = await call('/api/events', { method: 'POST', body: { name: '', passwordHash: noPass } })
  assert.equal(bad.status, 400)
  const badImage = await call('/api/events/' + eventId, { method: 'PUT', body: { coverImage: 'data:text/html;base64,xxx' } })
  assert.equal(badImage.status, 400)
  const traversal = await call('/api/events/..%2F..%2Fetc')
  assert.ok(traversal.status >= 400, 'path traversal rejected')
  console.log('✓ 非法输入被拒绝')

  // 11. 删除移入回收站
  const del = await call('/api/events/' + eventId, { method: 'DELETE' })
  assert.equal(del.status, 200)
  const afterDelete = await call('/api/events')
  assert.ok(!(eventId in afterDelete.data.data))
  console.log('✓ 删除账簿')

  console.log('\n全部接口测试通过')
}

main().catch((error) => {
  console.error('测试失败:', error)
  process.exit(1)
})

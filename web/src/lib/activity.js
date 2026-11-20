// 全局请求活动总线：只记录并发数和安全的界面文案，不暴露 URL 参数或业务数据。
import { reactive } from 'vue'

const labels = new Map()
let seq = 0

export const activityState = reactive({
  active: 0,
  label: '',
  tone: 'loading',
  revision: 0,
})

function syncState() {
  const values = [...labels.values()]
  activityState.active = labels.size
  activityState.label = values.length ? values[values.length - 1] : ''
  activityState.revision += 1
}

export function beginActivity(label = '正在加载数据') {
  const id = ++seq
  labels.set(id, String(label || '正在加载数据'))
  activityState.tone = 'loading'
  syncState()
  return id
}

export function endActivity(id, { failed = false } = {}) {
  labels.delete(id)
  activityState.tone = labels.size ? 'loading' : failed ? 'error' : 'done'
  syncState()
}

export function activityLabelFor(url, method = 'GET') {
  const path = String(url || '')
  if (path.includes('/api/update/check')) return '正在检查更新'
  if (path.includes('/api/update/apply')) return '正在下载并安装更新'
  if (path.includes('/api/update/progress')) return '正在读取更新进度'
  if (path.includes('/api/update/settings')) return '正在保存更新设置'
  if (path.includes('/verify')) return '正在验证账簿密钥'
  if (path.includes('/api/auth')) return '正在验证访问权限'
  if (path.includes('/api/family/login')) return '正在进入家庭空间'
  if (path.includes('/api/family/me')) return '正在读取家庭信息'
  if (path.includes('/api/gifts') && method === 'POST') return '正在保存礼金记录'
  if (path.includes('/api/gifts') && method === 'PUT') return '正在保存修改'
  if (path.includes('/api/gifts') && method === 'DELETE') return '正在删除记录'
  if (path.includes('/api/events') && method === 'GET') return '正在加载账簿'
  if (path.includes('/api/events') && method !== 'GET') return '正在保存账簿'
  if (path.includes('/api/capabilities') || path.includes('/api/build')) return '正在同步程序信息'
  if (method === 'GET') return '正在加载数据'
  if (method === 'DELETE') return '正在删除'
  return '正在保存更改'
}

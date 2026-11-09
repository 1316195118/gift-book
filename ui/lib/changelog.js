// 更新说明：v2 的新架构说明 + 原项目的历史发布记录（原样保留）。
// 原生 ES Module 不支持 Vite 的 JSON 导入，历史记录已转换为 .js 模块。
import history from './changelog-history.js'

export const APP_VERSION = '2.0.0'

const LOG_TAG = { feat: '新增', fix: '修复', sec: '安全', opt: '优化' }

const CURRENT = [
  {
    version: '2.0.0',
    date: '2026-11-04',
    notes: [
      { t: 'feat', text: '后端由 PHP 改为 Go 单文件可执行程序：内嵌前端，双击即用，内存占用远低于 PHP 容器' },
      { t: 'feat', text: '前端界面、配色、封面、竖排礼簿与原版保持一致' },
      { t: 'feat', text: '前端改为零第三方依赖的自研原生 ES Modules + CSS，移除 Vue / Vite 与全部 npm 依赖，ui/ 直接嵌入二进制，无需打包步骤' },
      { t: 'opt', text: '状态管理改为自研 Proxy 订阅、页面改为原生 DOM 渲染；构建与 Docker 镜像均不再需要 Node' },
      { t: 'feat', text: '新增整站备份：一键导出 zip（账簿 + 礼金 + 访问保护设置），换机器时导入即可迁移' },
      { t: 'sec', text: '统一 JSON 接口与同源校验；账簿钥匙只放在请求头、服务端只保存加盐校验值' },
      { t: 'opt', text: '存储仍为纯 JSON 文件（events.json / gifts_<id>.json），可直接指向旧数据的 data 目录' },
    ],
  },
]

export const CHANGELOG = [...CURRENT, ...history]

export function renderLogEntries(entries) {
  return entries
    .map(
      (entry) => `
      <div class="log-entry">
        <div class="log-head">
          <b>v${entry.version}</b>
          <span class="log-date">${entry.date}</span>
        </div>
        <ul class="log-list">
          ${entry.notes.map((n) => `<li><span class="log-tag log-tag-${n.t}">${LOG_TAG[n.t] || '变更'}</span><span>${n.text}</span></li>`).join('')}
        </ul>
      </div>`,
    )
    .join('')
}

export function renderChangelog() {
  return `
    <div class="log-wrap">${renderLogEntries(CHANGELOG)}</div>
    <p class="hint" style="margin-top:14px">当前版本 v${APP_VERSION} · 发布源 本机单文件</p>`
}

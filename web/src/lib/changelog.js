// 更新说明：v2 的新架构说明 + 原项目的历史发布记录（原样保留）。
import history from './changelog-history.json'

export const APP_VERSION = '2.3.0'

const LOG_TAG = { feat: '新增', fix: '修复', sec: '安全', opt: '优化' }

const CURRENT = [
  {
    version: '2.3.0',
    date: '2026-11-15',
    notes: [
      { t: 'opt', text: '弹窗加入退出动画：关闭时遮罩淡出、纸面上收，不再瞬间消失' },
      { t: 'feat', text: '汇总金额变化改为数字滚动；统计条形图可点击筛选明细；窄屏工具栏收进「更多」菜单' },
      { t: 'sec', text: '新增 Content-Security-Policy 与 Permissions-Policy：脚本仅允许同源产物，保留相机/麦克风同源权限' },
      { t: 'opt', text: '统计汇总统一为 stats-core 纯函数，主界面与统计弹窗共用同一口径，并补 4 项单元测试' },
      { t: 'opt', text: '新增 GitHub Actions CI：push / PR 自动跑 go vet、go test、前端构建与单元测试' },
    ],
  },
  {
    version: '2.2.1',
    date: '2026-11-15',
    notes: [
      { t: 'feat', text: '回礼支持多次登记：每笔可记录多次回礼（金额、备注、时间），可逐条撤销，统计与净人情按累计金额计算' },
      { t: 'feat', text: '礼簿竖排版新增「*已回礼」标记；统计新增「按关系」条形图，三张图并列展示' },
      { t: 'opt', text: '统计条形图加入展开动画，移动端保持单列，图表与明细更易读' },
    ],
  },
  {
    version: '2.2.0',
    date: '2026-11-15',
    notes: [
      { t: 'feat', text: '礼金新增「关系」标签（亲戚/朋友/同事/同学/邻居/其他），统计按关系汇总各类金额，Excel/Word 导出同步新增关系列' },
      { t: 'feat', text: '新增回礼 / 人情追踪：详情里可登记回礼金额，统计显示已回礼、未回礼与净人情' },
      { t: 'feat', text: '新增 CSV 批量导入：从名单批量录入，带表头自动识别姓名/金额/方式/关系/备注，逐行校验并预览' },
      { t: 'feat', text: '统计新增金额 Top 5、去重人数与人均礼金；新增跨账簿汇总，按姓名聚合多场事的累计人情' },
      { t: 'feat', text: '打印设置新增签到表：按姓名排序生成 A4 签到表，含关系与签名栏，自动分页' },
      { t: 'feat', text: '支持 PWA：可添加到主屏幕，静态资源离线缓存，断网也能打开已访问页面' },
      { t: 'sec', text: '弹窗提示统一做 HTML 转义，堵住 API 或用户输入造成的二次注入' },
      { t: 'opt', text: '移除被自动备份面板取代的旧备份弹窗；新增 Vitest 前端单元测试（金额大写、转义、CSV 解析等 21 项）' },
    ],
  },
  {
    version: '2.1.0',
    date: '2026-11-14',
    notes: [
      { t: 'fix', text: '修复 PDF 导出一直提示「PDF 生成失败」：排版页的 SVG 少了一个闭合标签，浏览器无法解码；现在可正常导出含封面与竖排礼簿的 A4 横向 PDF' },
      { t: 'feat', text: '录入成功落「囍 / 寿 / 奠」印，红事建簿撒喜字金点、白事改为素银淡墨；点击有涟漪与按钮指向反馈，白事不出现任何红金喜庆元素' },
      { t: 'feat', text: '新增 Web Audio 合成的 8 种提示音（点击、落印、喜庆、成功、警告、翻页、主题、白事素音），默认关闭，首页「静音 / 音效开」与账簿设置里均可开启；系统减动效时自动静音' },
      { t: 'feat', text: '成功提示改为右上角轻提示（最多 3 条、带进度条、悬停暂停），不再弹窗打断；页面切换有方向感，礼簿翻页与汇总数字变化各有一次反馈' },
      { t: 'feat', text: '大字模式在手机 / 平板 / 桌面都真正生效；弹窗支持 ESC 关闭与键盘焦点管理，首屏有骨架屏，空账簿有引导插画' },
      { t: 'opt', text: '账簿数据只放 data/，认证状态、自动备份设置与备份包放 config/；旧版 rundata/ 在启动时自动迁移，只复制不删除、不覆盖' },
      { t: 'opt', text: '静态资源按浏览器支持自动 gzip（CSS 约 130KB→27KB、JS 约 232KB→85KB），带哈希产物长期缓存；镜像已内置默认启动参数，compose 无需再写 command' },
      { t: 'fix', text: '修复创建页「更多设置」收起时仍渲染并遮住封面款式、轻提示盖住弹窗关闭按钮、点击涟漪在左上角偏移、备份还原后成功/失败提示丢失、导入备份失败无提示等问题' },
      { t: 'sec', text: '备份文件名拼接弹窗内容时补齐 HTML 转义；访问保护新增可选的 GIFTBOOK_SETUP_TOKEN 与受信任反代开关' },
      { t: 'opt', text: 'OCR 自写调用源码随仓库提供，模型与依赖需自行准备（可选功能，默认不启用）；Vite 构建警告清零，Go 源码统一 LF 换行' },
    ],
  },
  {
    version: '2.0.0',
    date: '2026-11-04',
    notes: [
      { t: 'feat', text: '后端由 PHP 改为 Go 单文件可执行程序：内嵌前端，双击即用，内存占用远低于 PHP 容器' },
      { t: 'feat', text: '前端改用 Vue 3 + Vite 工程化实现，界面、配色、封面、竖排礼簿与原版保持一致' },
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
    <p class="hint" style="margin-top:14px">当前版本 v${APP_VERSION} · 发布源 单文件 / Docker / GHCR 镜像</p>`
}

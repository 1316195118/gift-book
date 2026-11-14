// 更新说明：v2 的新架构说明 + 原项目的历史发布记录（原样保留）。
import history from './changelog-history.json'

export const APP_VERSION = '2.3.7'

const LOG_TAG = { feat: '新增', fix: '修复', sec: '安全', opt: '优化' }

const CURRENT = [
  {
    version: '2.3.7',
    date: '2026-11-15',
    notes: [
      { t: 'fix', text: '修复历史修改痕迹时间线圆点压住时间文字：圆点样式改专用类，不再依赖未生成的 Tailwind 任意值' },
    ],
  },
  {
    version: '2.3.6',
    date: '2026-11-15',
    notes: [
      { t: 'fix', text: '礼簿姓名格改为「名字区 + 标记区」分层：备注/回礼/修改等标记不再与姓名文字重叠' },
      { t: 'fix', text: '弹窗标题超长自动截断；统计「录入时间」列与首页日期行防压缩，斜杠与分隔点不再错位' },
      { t: 'opt', text: '手机端页面切换动画去 3D 翻书与位移，只留 220ms 淡入——进入模板/创建页不再卡顿' },
    ],
  },
  {
    version: '2.3.5',
    date: '2026-11-15',
    notes: [
      { t: 'opt', text: '提示 / 确认类弹窗支持点遮罩关闭；密码与表单类保持防误关；关闭键悬停微旋转反馈' },
      { t: 'opt', text: '开关滑块等散落颜色归一为设计令牌，样式表零硬编码颜色；弹窗动效与焦点环统一走令牌' },
    ],
  },
  {
    version: '2.3.4',
    date: '2026-11-15',
    notes: [
      { t: 'opt', text: '移除「更多」按钮与下拉菜单：手机工具栏所有动作单行横滑直达，不再有折叠入口' },
    ],
  },
  {
    version: '2.3.3',
    date: '2026-11-15',
    notes: [
      { t: 'opt', text: '手机记录页顺序调整：查询与礼簿在上，礼金录入卡片沉到最底，打开先看记录' },
      { t: 'opt', text: '手机工具栏取消「更多」收纳，改为单行横滑，所有动作一眼可见、一滑可达' },
      { t: 'fix', text: '修复「进入账簿 / 导出」弹窗关闭键乱跳：卡片内 × 与标题栏 × 重叠，且点击事件被误当成「立即关闭」参数，导致内容瞬间清空' },
      { t: 'fix', text: '关闭弹窗时焦点恢复不再带动页面滚动；退场动画结束后再恢复背景滚动，避免回弹' },
    ],
  },
  {
    version: '2.3.2',
    date: '2026-11-15',
    notes: [
      { t: 'fix', text: '修复登记回礼 / 纠错后礼簿顺序被打乱：修改不再改写录入时间，排序以首次登记时间为准——登记顺序永不改变' },
      { t: 'opt', text: '已被旧版本改乱的历史记录，会按首次修改快照里的原始时间自动归位' },
    ],
  },
  {
    version: '2.3.1',
    date: '2026-11-15',
    notes: [
      { t: 'opt', text: '手机端弹窗统一为底部抽屉：全宽、上圆角、88% 视高、顶部抓握条，关闭键加大到 44px' },
      { t: 'opt', text: '手机录入表单改单列；汇总卡改为「总额一行 + 两张并排」；搜索栏自动换行；工具栏「更多」收纳提前到 900px' },
      { t: 'opt', text: 'toast 在手机上贴顶显示，避开右上工具条；卡片留白与礼簿纸面阴影微调' },
      { t: 'opt', text: '翻页 420ms、弹窗退场 200ms、toast 300ms 更柔和；补全 prefers-reduced-motion（数字滚动直接跳值）' },
      { t: 'fix', text: '收款码浮窗小屏定位与拖拽边界改读实际尺寸，不再按固定 280×320 计算' },
    ],
  },
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

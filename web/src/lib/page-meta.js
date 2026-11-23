// 每个公开或核心 SPA 页面只在这里维护一份搜索与分享元信息。
const PAGES = {
  home: {
    title: '电子礼簿｜红白事礼金多人登记、加密保存与统计导出更安心',
    description: '电子礼簿为婚宴、寿宴、满月与追思等场景提供多人礼金登记、本地加密保存、实时统计、打印和表格导出，数据留在自己的部署中，操作清楚又安心，适合家庭与多人协作场景。',
    robots: 'index,follow',
  },
  template: {
    title: '礼簿模板｜婚宴寿宴满月乔迁与追思场景一站式快速选择',
    description: '按婚宴、寿宴、满月、乔迁、丧仪或追思等场景挑选合适的礼簿模板，快速建立称谓、封面与版式都匹配的电子账簿，让开场准备更省心，并随时调整封面与分页规则。',
    robots: 'noindex,follow',
  },
  setup: {
    title: '创建新礼簿｜设置时间地点、封面样式与加密密码安全保护',
    description: '填写礼簿名称、起止时间、地点和封面样式，可按需设置管理密码保护礼金明细；创建完成后即可邀请家人同时登记，多人协作更高效，并支持继续修改模板和打印版式。',
    robots: 'noindex,nofollow',
  },
  main: {
    title: '礼金记录与统计｜电子礼簿多人协作实时记账与核对的安心工作台',
    description: '快速录入礼金或奠仪，实时查看人数、总额与分类统计，支持多人协作、回礼记录、分页打印以及多种格式安全导出，每一笔往来都清楚可查，并可按家庭与账簿权限安全共享协作。',
    robots: 'noindex,nofollow',
  },
  guest: {
    title: '宾客礼金登记｜电子礼簿扫码填写、主家确认与安全入簿流程',
    description: '通过主家分享的临时链接提交姓名、礼金金额、关系和留言；主家核对确认后才会写入账簿，登记入口可随时关闭，公开信息收集范围清楚可控，避免无关信息被长期保存或误用。',
    robots: 'noindex,nofollow',
  },
  terms: {
    title: '服务条款｜电子礼簿账户规范、内容权利与免责声明说明',
    description: '了解电子礼簿的服务范围、账户与访问凭证要求、使用规范、用户内容、数据备份、免责声明与争议处理方式，帮助家庭成员安心使用和协作，共同维护可靠的协作环境。',
    robots: 'index,follow',
  },
  privacy: {
    title: '隐私政策｜电子礼簿数据收集、加密保存与完整删除说明',
    description: '了解电子礼簿收集哪些必要信息、礼金数据如何加密保存、日志和备份保留多久，以及你如何访问、更正、导出或删除数据，隐私边界清晰透明，帮助主家与宾客都能明白数据去向。',
    robots: 'index,follow',
  },
}

function setMeta(selector, value) {
  const element = document.head.querySelector(selector)
  if (element) element.setAttribute('content', value)
}

export function applyPageMeta(route) {
  const meta = PAGES[route] || PAGES.home
  document.title = meta.title
  setMeta('meta[name="description"]', meta.description)
  setMeta('meta[name="robots"]', meta.robots)
  setMeta('meta[property="og:title"]', meta.title)
  setMeta('meta[property="og:description"]', meta.description)
  setMeta('meta[name="twitter:title"]', meta.title)
  setMeta('meta[name="twitter:description"]', meta.description)
}

export { PAGES as PAGE_META }

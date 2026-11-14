// 文案：红事 / 白事完全分开维护，白事页面不得出现红事字眼。
// 礼金关系选项：录入表单与详情修改共用，避免两处各写一份。
export const RELATION_OPTIONS = ['亲戚', '朋友', '同事', '同学', '邻居', '其他']
export const RELATION_FALLBACK = '未分类'

export const UX_COPY = {
  festive: {
    entryTitle: '礼金录入',
    entrySub: '每一份心意，都郑重留名',
    nameLabel: '来宾姓名',
    namePlaceholder: '请输入来宾姓名',
    amountLabel: '礼金金额',
    remarksPlaceholder: '亲友关系、地址等补充说明',
    bookTitle: '贺礼簿',
    bookType: '贺 礼',
    emptyHint: '本页还没有记录，输入第一位来宾即可开始。',
    bookNote: '点击姓名查看详情与修改记录；点击金额可播报。窄屏可左右滑动查看完整礼簿。',
    recordNoun: '礼金',
    peopleNoun: '来宾',
    totalLabel: '礼金总额 / 元',
    giversLabel: '送礼人数',
    detailTitle: '礼金明细',
    fileSuffix: '礼金明细',
    recordsLabel: '礼金记录',
    setupSub: '填写账簿信息，创建后即可开始登记礼金',
    locationLabel: '宴请地点',
    namePh: '例如：张三李四新婚之喜',
    locationPh: '例如：某某大酒店 3 楼',
    notePh: '选填，如：男方亲友',
    pwdHint: '密码用于 AES 加密礼金数据，遗忘将无法恢复。留空也能正常使用，只是任何拿到地址的人都能打开这本账簿 —— 建议设置。',
    stepScene: '婚宴、寿宴或满月，套用对应礼俗称谓',
    stepEntry: '录入礼金，随时打印或导出 Excel',
    statsTitle: '礼金统计详情',
    statsGivers: '总送礼人数',
    statsTotal: '总礼金金额',
    confirmGuestLabel: '来宾姓名',
    remarksTip: '建议备注宾客与东家关系或地址',
    historyWarning: '警告：此宾客数据存在修改，请自行核验合法性。',
    qrTip: '宾客扫码即可付款',
    exportEmpty: '当前账簿还没有任何礼金记录。',
    printTotalGivers: '送礼总人数',
    printTotalAmount: '礼金总金额',
    appendixTitle: '附录：宾客备注',
    historyNote: '礼金记录只改不删，每次纠错都会保留原始快照。',
    voiceSample: '张三贺礼五百元整',
    voiceAddPrefix: '贺礼',
    speechHint: '只有大于或等于此金额的礼金才会被播报。设置为 0 则全部播报。',
    deleteSingleNote: '单条礼金记录不支持删除，只能修改；整本账簿删除是唯一会丢数据的方式，请确认确实不再需要。',
    helpIntro: '四步开始，把热闹喜事记成一本清楚的礼簿。',
    helpStep1: '首页选择「红事」，再挑一个婚宴、寿宴或满月等模板。',
    helpStep2: '填写名称、起止时间与宴请地点；管理密码可选填，建议设置以便加密礼金数据。',
    helpStep3: '输入来宾姓名、礼金与收款方式，核对后保存。可展示收款码，临时离开时锁定防误触。',
    helpStep4: '导出 Excel 明细、PDF 贺礼簿或 Word 文档；打印版式与屏幕一致。',
    helpTip: '数据保存在您的 NAS，不是当前手机或电脑。需连接部署所在的网络使用，建议定期导出备份。姓名、金额、备注等礼金明细只保存在 AES 密文中，服务器只保留账簿 ID、录入时间等必要元数据；仍请仅在可信网络使用。',
  },
  solemn: {
    entryTitle: '奠仪录入',
    entrySub: '每一份哀思，都郑重留名',
    nameLabel: '吊唁人姓名',
    namePlaceholder: '请输入吊唁人姓名',
    amountLabel: '奠仪金额',
    remarksPlaceholder: '与逝者关系、地址等补充说明',
    bookTitle: '奠仪簿',
    bookType: '奠 仪',
    emptyHint: '本页还没有记录，录入第一位吊唁人即可开始。',
    bookNote: '点击姓名查看详情与修改记录；点击金额可播报。窄屏可左右滑动查看完整奠仪簿。',
    recordNoun: '奠仪',
    peopleNoun: '吊唁人',
    totalLabel: '奠仪总额 / 元',
    giversLabel: '奠仪人数',
    detailTitle: '奠仪明细',
    fileSuffix: '奠仪明细',
    recordsLabel: '奠仪记录',
    setupSub: '填写账簿信息，创建后即可开始登记奠仪',
    locationLabel: '仪式地点',
    namePh: '例如：家父追思会',
    locationPh: '例如：市殡仪馆 追思厅',
    notePh: '选填，如：亲属 / 同事',
    pwdHint: '密码用于 AES 加密奠仪数据，遗忘将无法恢复。留空也能正常使用，只是任何拿到地址的人都能打开这本账簿 —— 建议设置。',
    stepScene: '丧仪、追思或周年，套用对应礼俗称谓',
    stepEntry: '录入奠仪，随时打印或导出 Excel',
    statsTitle: '奠仪统计详情',
    statsGivers: '总奠仪人数',
    statsTotal: '总奠仪金额',
    confirmGuestLabel: '吊唁人姓名',
    remarksTip: '建议备注吊唁人与逝者关系或地址',
    historyWarning: '提醒：此条奠仪数据存在修改，请自行核验。',
    qrTip: '扫码即可致奠',
    exportEmpty: '当前账簿还没有任何奠仪记录。',
    printTotalGivers: '奠仪总人数',
    printTotalAmount: '奠仪总金额',
    appendixTitle: '附录：吊唁人备注',
    historyNote: '奠仪记录只改不删，每次纠错都会保留原始快照。',
    voiceSample: '张三敬献奠仪五百元整',
    voiceAddPrefix: '奠仪',
    speechHint: '只有大于或等于此金额的奠仪才会被播报。设置为 0 则全部播报。',
    deleteSingleNote: '单条奠仪记录不支持删除，只能修改；整本账簿删除是唯一会丢数据的方式，请确认确实不再需要。',
    helpIntro: '四步完成，庄重登记每一份奠仪与哀思。',
    helpStep1: '首页选择「白事」，再挑一个丧仪、追思或周年模板。',
    helpStep2: '填写名称、起止时间与仪式地点；管理密码可选填，建议设置以便加密奠仪数据。',
    helpStep3: '录入吊唁人姓名、奠仪金额与收款方式，核对后保存。可展示收款码，临时离开时锁定防误触。',
    helpStep4: '导出奠仪明细、PDF 奠仪簿或 Word 文档；打印版式与屏幕一致。',
    helpTip: '数据保存在您的 NAS，不是当前手机或电脑。需连接部署所在的网络使用，建议定期导出备份。姓名、金额、备注等奠仪明细只保存在 AES 密文中，服务器只保留账簿 ID、录入时间等必要元数据；仍请仅在可信网络使用。',
  },
}

export const CATEGORY_TEXT = {
  red: {
    eyebrow: '传统礼俗 · 数字留痕',
    title: '今日何喜，敬请择类',
    sub: '选择红事场景，登记礼金、汇总账簿并打印明细。',
    kicker: '喜 事',
    cardTitle: '红事',
    cardDesc: '婚嫁 · 寿诞 · 满月 · 乔迁 · 升学',
    go: '选择红事模板',
    tplEyebrow: '红 事',
    theme: 'theme-festive',
  },
  white: {
    eyebrow: '慎终追远 · 肃穆致哀',
    title: '白事登记，敬请择类',
    sub: '按白事礼俗逐笔登记，清晰汇总每份心意。',
    kicker: '白 事',
    cardTitle: '白事',
    cardDesc: '丧仪 · 追思 · 周年 · 迁坟',
    go: '选择白事模板',
    tplEyebrow: '白 事',
    theme: 'theme-solemn',
  },
}

export const RED_TEMPLATES = [
  { key: 'wedding', name: '婚宴', glyph: '囍', sub: '婚礼喜宴', desc: '新婚婚宴场景使用，来宾祝贺入簿，称谓多用「贺礼」。' },
  { key: 'birthday', name: '寿宴', glyph: '寿', sub: '长辈寿宴', desc: '长辈寿宴，晚辈贺寿入簿，常用典故「福如东海 寿比南山」。' },
  { key: 'fullmoon', name: '满月酒', glyph: '满', sub: '满月 / 百日', desc: '新生儿满月、百日之喜，亲友赠礼留名，可备注满月礼、满月宴。' },
  { key: 'housewarming', name: '乔迁宴', glyph: '迁', sub: '乔迁之喜', desc: '新居落成、迁入新居，亲友送礼「贺乔迁」、随礼入簿。' },
  { key: 'school', name: '升学宴', glyph: '学', sub: '升学 / 谢师', desc: '升学宴、谢师宴、开业庆典及其他喜事，通用礼金登记。' },
]

export const WHITE_TEMPLATES = [
  { key: 'funeral', name: '丧事', glyph: '奠', sub: '丧仪', desc: '丧仪奠仪登记，称谓多用「奠仪」「帛金」。' },
  { key: 'baishi', name: '白事', glyph: '白', sub: '通用', desc: '白事礼簿通用，庄重肃穆，适用于各类丧仪。' },
  { key: 'memorial', name: '追思', glyph: '思', sub: '追思 / 悼念', desc: '追思会、悼念仪式奠仪登记。' },
  { key: 'anniversary', name: '周年', glyph: '周', sub: '周年祭', desc: '周年祭礼登记，缅怀先人。' },
  { key: 'reburial', name: '迁坟', glyph: '迁', sub: '迁坟 / 安葬', desc: '迁坟、安葬仪式奠仪登记。' },
]

export const BLESSINGS = {
  wedding: '良缘永结 · 礼记长存',
  birthday: '福寿绵长 · 心意入簿',
  fullmoon: '新生有喜 · 岁岁安康',
  housewarming: '新居纳福 · 嘉礼相贺',
  school: '金榜题名 · 前程似锦',
  funeral: '慎终追远 · 心意长存',
  baishi: '庄重留名 · 铭记心意',
  memorial: '追思故人 · 感念深情',
  anniversary: '岁月流转 · 思念长存',
  reburial: '敬记心意 · 慎终追远',
}

// 封面样式（全部自绘）：模板只决定文字，样式只决定外观。
export const COVER_STYLES = [
  { id: 'shuangxi', name: '双喜金章', theme: 'red', frame: 'double', corners: 'floral', medallion: true, tassel: true, layout: 'center', weave: true },
  { id: 'lihe', name: '礼盒纹', theme: 'red', frame: 'thick', corners: 'floral', medallion: true, tassel: true, layout: 'center', weave: true },
  { id: 'wujia', name: '我家大喜', theme: 'red', frame: 'single', corners: 'cloud', medallion: true, tassel: false, layout: 'vertical', weave: true },
  { id: 'manyue', name: '弥月之喜', theme: 'red', frame: 'strip', corners: 'cloud', medallion: true, tassel: true, layout: 'vertical', label: '弥月之喜', weave: true },
  { id: 'duanmian', name: '缎面素章', theme: 'red', frame: 'none', corners: 'vine', medallion: false, tassel: false, layout: 'center', weave: true },
  { id: 'chanzhi', name: '缠枝双喜', theme: 'red', frame: 'double', corners: 'vine', medallion: true, tassel: false, layout: 'center', weave: true },
  { id: 'sujuan', name: '素绢', theme: 'white', frame: 'single', corners: 'cloud', medallion: true, tassel: false, layout: 'center' },
  { id: 'baiju', name: '白菊', theme: 'white', frame: 'double', corners: 'floral', medallion: true, tassel: false, layout: 'center' },
  { id: 'liantai', name: '莲台', theme: 'white', frame: 'strip', corners: 'cloud', medallion: true, tassel: false, layout: 'vertical' },
]

export const TEMPLATE_DEFAULT_STYLE = {
  wedding: 'shuangxi', birthday: 'lihe', fullmoon: 'manyue', housewarming: 'wujia', school: 'duanmian',
  funeral: 'sujuan', baishi: 'baiju', memorial: 'liantai', anniversary: 'sujuan', reburial: 'baiju',
}

export const COVER_CORNERS = {
  floral: '<path d="M4 31c0-13 9-23 22-23"/><path d="M11 35c0-10 7-17 17-17"/><path d="M16 37c4-6 10-6 15-2-4 6-11 6-15 2Z"/><path d="M6 22c-2 5 0 9 4 10"/>',
  cloud: '<path d="M4 16c5-7 11-7 15 0s10 7 15 0M4 26c5-7 11-7 15 0s10 7 15 0M4 36c5-7 11-7 15 0"/>',
  vine: '<path d="M4 35C6 20 18 8 35 6"/><path d="M11 27c-1-5 2-8 6-8 1 5-2 8-6 8Z"/><path d="M19 18c-1-5 2-8 6-8 1 5-2 8-6 8Z"/><path d="M26 32c4-1 7 1 7 5-4 1-7-1-7-5Z"/>',
}

export const COVER_TASSEL = '<svg class="cover-tassel" viewBox="0 0 24 64" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" aria-hidden="true"><path d="M12 0v18"/><path d="M9 22l3-4 3 4-3 4z"/><path d="M12 30v6"/><path d="M8 38c0 8 1 16 4 24M16 38c0 8-1 16-4 24M12 38v24" opacity=".75"/></svg>'

export function isSolemnEvent(ev, homeCategory = 'red') {
  if (!ev) return homeCategory === 'white'
  const template = String(ev.template || '').trim()
  const whiteKeys = new Set(WHITE_TEMPLATES.flatMap((item) => [item.key, item.name]))
  const redKeys = new Set(RED_TEMPLATES.flatMap((item) => [item.key, item.name]))
  if (ev.theme === 'theme-solemn') return true
  if (whiteKeys.has(template)) return true
  if (ev.theme === 'theme-festive') return false
  if (redKeys.has(template)) return false
  return /丧|白事|追思|周年|迁坟/.test(ev.name || '')
}

export function categoryForEvent(ev, homeCategory = 'red') {
  return isSolemnEvent(ev, homeCategory) ? 'white' : 'red'
}

export function eventTheme(ev, homeCategory = 'red') {
  return isSolemnEvent(ev, homeCategory) ? 'theme-solemn' : 'theme-festive'
}

export function copyOf(ev, homeCategory = 'red') {
  const solemn = ev ? isSolemnEvent(ev, homeCategory) : homeCategory === 'white'
  return solemn ? UX_COPY.solemn : UX_COPY.festive
}

export function templatesFor(category) {
  return category === 'white' ? WHITE_TEMPLATES : RED_TEMPLATES
}

export function getCoverTemplate(ev = {}, homeCategory = 'red') {
  const list = isSolemnEvent(ev, homeCategory) ? WHITE_TEMPLATES : RED_TEMPLATES
  return list.find((t) => t.key === ev.template || t.name === ev.template) || list[0]
}

export function getCoverStyle(ev = {}, homeCategory = 'red') {
  const theme = isSolemnEvent(ev, homeCategory) ? 'white' : 'red'
  const list = COVER_STYLES.filter((item) => item.theme === theme)
  const wanted = ev.coverStyle || TEMPLATE_DEFAULT_STYLE[getCoverTemplate(ev, homeCategory).key]
  return list.find((item) => item.id === wanted) || list[0]
}

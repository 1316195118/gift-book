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
    bookNote: '点击姓名查看详情与修改记录；点击金额可播报。窄屏可左右滑动查看完整礼簿。多人同时登记时，礼簿会自动更新。',
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
    stepScene: '婚宴、寿宴或满月，套用对应礼俗称谓；也可直接创建',
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
    helpIntro: '四步开始，把热闹喜事记成一本清楚的礼簿；多台设备可以同时登记。',
    helpStep1: '首页选择「红事」：点模板卡片挑一个场景，或直接点「创建新账簿」。',
    helpStep2: '填写名称、起止时间与宴请地点；管理密码可选填，建议设置以便加密礼金数据。创建后可多人同时登记，改动会自动同步。',
    helpStep3: '输入来宾姓名、礼金、收款方式与关系，核对后保存；详情里可登记回礼。可展示收款码，临时离开时锁定防误触。',
    helpStep4: '导出 Excel 明细、PDF 贺礼簿或 Word 文档，也可打印 A4 签到表；打印版式与屏幕一致。',
    helpTip: '数据保存在您的 NAS，不是当前手机或电脑，需连接部署所在的网络使用；建议在首页「备份」开启自动备份，并定期导出留底。姓名、金额、备注等礼金明细只存在 AES 密文中，服务器只保存账簿信息（名称、时间、地点）与密文；仍请仅在可信网络使用。',
    helpFeatures: [
      ['多人同时登记', '同一服务下，多台设备可同时记账；别人的录入会自动出现，不需要刷新。'],
      ['自动备份', '首页「设置 → 备份与恢复」可设置每隔几小时自动备份并保留最近几份，换机器时一键还原；仅管理员可用。'],
      ['关系与回礼', '每笔可标关系（亲戚、朋友等）用于分类汇总；详情里登记回礼，统计显示已回礼、未回礼与净人情。'],
      ['批量导入', '导出面板里的「批量导入 CSV」可从名单一次录入，自动识别表头并逐行校验。'],
      ['扫描礼簿', '手机拍照识别纸质礼簿，核对后加密导入（可选功能，需部署 OCR 模型）。'],
      ['统计与签到表', '按收款方式、关系、日期汇总；打印可选 A4 签到表，含关系与签名栏。'],
      ['离线也能用', '添加到主屏幕后，断网也能打开已访问页面；录入会暂存本机，联网后自动补传。'],
      ['选择范围导出', '导出面板可先「选择记录」：按姓名、关系、回礼状态筛选后勾选，Excel / PDF / Word 与回礼明细都只导出所选，合计也按所选计算。'],
      ['未回礼名单', '导出面板列出还没回礼的人，可一次勾选多笔批量登记回礼，也能单独导出名单；白事账簿不提供回礼功能。'],
      ['结簿与回收站', '设置里可把账簿结簿归档（只读、随时解除）；误删的账簿可在首页「回收站」一键恢复。'],
      ['多家庭与家庭备份', '每个家庭用访问码进入，彼此看不到账簿；成员可在「设置 → 家庭备份」导出或还原自己的家庭，整站备份仅管理员可用。'],
    ],
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
    bookNote: '点击姓名查看详情与修改记录；点击金额可播报。窄屏可左右滑动查看完整奠仪簿。多人同时登记时，礼簿会自动更新。',
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
    stepScene: '丧仪、追思或周年，套用对应礼俗称谓；也可直接创建',
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
    helpIntro: '四步完成，庄重登记每一份奠仪与哀思；多台设备可以同时登记。',
    helpStep1: '首页选择「白事」：点模板卡片挑一个场景，或直接点「创建新账簿」。',
    helpStep2: '填写名称、起止时间与仪式地点；管理密码可选填，建议设置以便加密奠仪数据。创建后可多人同时登记，改动会自动同步。',
    helpStep3: '录入吊唁人姓名、奠仪金额、收款方式与关系，核对后保存。可展示收款码，临时离开时锁定防误触。',
    helpStep4: '导出奠仪明细、PDF 奠仪簿或 Word 文档，也可打印 A4 签到表；打印版式与屏幕一致。',
    helpTip: '数据保存在您的 NAS，不是当前手机或电脑，需连接部署所在的网络使用；建议在首页「备份」开启自动备份，并定期导出留底。姓名、金额、备注等奠仪明细只存在 AES 密文中，服务器只保存账簿信息（名称、时间、地点）与密文；仍请仅在可信网络使用。',
    helpFeatures: [
      ['多人同时登记', '同一服务下，多台设备可同时登记；别人的录入会自动出现，不需要刷新。'],
      ['自动备份', '首页「设置 → 备份与恢复」可设置每隔几小时自动备份并保留最近几份，换机器时一键还原；仅管理员可用。'],
      ['按关系汇总', '每笔可标关系（亲戚、朋友等），统计按关系汇总各类奠仪金额。'],
      ['批量导入', '导出面板里的「批量导入 CSV」可从名单一次录入，自动识别表头并逐行校验。'],
      ['扫描礼簿', '手机拍照识别纸质礼簿，核对后加密导入（可选功能，需部署 OCR 模型）。'],
      ['统计与签到表', '按收款方式、关系、日期汇总；打印可选 A4 签到表，含关系与签名栏。'],
      ['离线也能用', '添加到主屏幕后，断网也能打开已访问页面；录入会暂存本机，联网后自动补传。'],
      ['选择范围导出', '导出面板可先「选择记录」：按姓名、关系筛选后勾选，Excel / PDF / Word 只导出所选，合计也按所选计算。'],
      ['结簿与回收站', '设置里可把账簿结簿归档（只读、随时解除）；误删的账簿可在首页「回收站」一键恢复。'],
      ['多家庭与家庭备份', '每个家庭用访问码进入，彼此看不到账簿；成员可在「设置 → 家庭备份」导出或还原自己的家庭，整站备份仅管理员可用。'],
    ],
  },
}

export const CATEGORY_TEXT = {
  red: {
    title: '把每一份心意，记得清清楚楚',
    sub: '红事礼金多人同时登记，金额自动汇总，随时打印或导出。',
    kicker: '喜 事',
    cardTitle: '红事',
    cardDesc: '婚嫁 · 寿诞 · 满月 · 乔迁 · 升学',
    go: '选择场景并创建',
    theme: 'theme-festive',
  },
  white: {
    title: '把每一份敬意，稳妥记下',
    sub: '白事奠仪多人同时登记，金额自动汇总，随时打印或导出。',
    kicker: '白 事',
    cardTitle: '白事',
    cardDesc: '丧仪 · 追思 · 周年 · 迁坟',
    go: '选择场景并创建',
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
  { id: 'longfeng', name: '龙凤呈祥', theme: 'red', frame: 'double', corners: 'phoenix', medallion: true, tassel: true, layout: 'center', weave: true },
  { id: 'huakai', name: '花开富贵', theme: 'red', frame: 'thick', corners: 'blossom', medallion: false, tassel: false, layout: 'center', weave: false },
  { id: 'bairi', name: '百日之喜', theme: 'red', frame: 'strip', corners: 'cloud', medallion: true, tassel: false, layout: 'vertical', weave: true },
  { id: 'huimen', name: '回门之喜', theme: 'red', frame: 'single', corners: 'blossom', medallion: true, tassel: true, layout: 'center', weave: true },
  { id: 'xieshi', name: '谢师金榜', theme: 'red', frame: 'none', corners: 'scroll', medallion: false, tassel: false, layout: 'vertical', weave: false },
  { id: 'wufu', name: '五福临门', theme: 'red', frame: 'double', corners: 'cloud', medallion: true, tassel: false, layout: 'center', weave: true },
  { id: 'jinyu', name: '金玉良缘', theme: 'red', frame: 'double', corners: 'blossom', medallion: true, tassel: true, layout: 'center', weave: true },
  { id: 'mantang', name: '满堂红', theme: 'red', frame: 'strip', corners: 'cloud', medallion: true, tassel: false, layout: 'vertical', weave: true },
  { id: 'tongxin', name: '同心永结', theme: 'red', frame: 'thick', corners: 'vine', medallion: true, tassel: true, layout: 'center', weave: false },
  { id: 'qianxi', name: '乔迁纳福', theme: 'red', frame: 'single', corners: 'scroll', medallion: false, tassel: false, layout: 'center', weave: true },
  { id: 'sujuan', name: '素绢', theme: 'white', frame: 'single', corners: 'cloud', medallion: true, tassel: false, layout: 'center' },
  { id: 'baiju', name: '白菊', theme: 'white', frame: 'double', corners: 'floral', medallion: true, tassel: false, layout: 'center' },
  { id: 'liantai', name: '莲台', theme: 'white', frame: 'strip', corners: 'cloud', medallion: true, tassel: false, layout: 'vertical' },
  { id: 'suju', name: '素菊', theme: 'white', frame: 'thick', corners: 'chrysanthemum', medallion: true, tassel: false, layout: 'center' },
  { id: 'songbai', name: '松柏', theme: 'white', frame: 'single', corners: 'pine', medallion: false, tassel: false, layout: 'vertical' },
  { id: 'qingyan', name: '青烟', theme: 'white', frame: 'none', corners: 'ripple', medallion: false, tassel: false, layout: 'center' },
  { id: 'changsi', name: '长思', theme: 'white', frame: 'double', corners: 'moon', medallion: true, tassel: false, layout: 'vertical' },
  { id: 'yuanshan', name: '远山', theme: 'white', frame: 'thick', corners: 'mountain', medallion: true, tassel: false, layout: 'center' },
  { id: 'qingzhu', name: '清竹', theme: 'white', frame: 'single', corners: 'pine', medallion: false, tassel: false, layout: 'center' },
  { id: 'qiulu', name: '清露', theme: 'white', frame: 'none', corners: 'floral', medallion: true, tassel: false, layout: 'center' },
  { id: 'qiusheng', name: '秋声', theme: 'white', frame: 'strip', corners: 'chrysanthemum', medallion: true, tassel: false, layout: 'vertical' },
  { id: 'huaien', name: '怀恩', theme: 'white', frame: 'double', corners: 'moon', medallion: false, tassel: false, layout: 'center' },
]

export const TEMPLATE_DEFAULT_STYLE = {
  wedding: 'shuangxi', birthday: 'lihe', fullmoon: 'manyue', housewarming: 'wujia', school: 'xieshi',
  funeral: 'sujuan', baishi: 'baiju', memorial: 'liantai', anniversary: 'changsi', reburial: 'songbai',
}

export const COVER_CORNERS = {
  floral: '<path d="M4 31c0-13 9-23 22-23"/><path d="M11 35c0-10 7-17 17-17"/><path d="M16 37c4-6 10-6 15-2-4 6-11 6-15 2Z"/><path d="M6 22c-2 5 0 9 4 10"/>',
  cloud: '<path d="M4 16c5-7 11-7 15 0s10 7 15 0M4 26c5-7 11-7 15 0s10 7 15 0M4 36c5-7 11-7 15 0"/>',
  vine: '<path d="M4 35C6 20 18 8 35 6"/><path d="M11 27c-1-5 2-8 6-8 1 5-2 8-6 8Z"/><path d="M19 18c-1-5 2-8 6-8 1 5-2 8-6 8Z"/><path d="M26 32c4-1 7 1 7 5-4 1-7-1-7-5Z"/>',
  phoenix: '<path d="M5 35C9 20 22 8 36 5"/><path d="M8 30c7-1 12-4 16-10M13 25c5 0 9-2 12-6M19 19c4 1 7 0 10-3"/><path d="M5 18c5-1 8-4 10-8 1 5 0 9-3 13"/>',
  blossom: '<path d="M5 35C10 22 20 12 35 6"/><path d="M13 25c-4-5-2-9 1-11 4 2 5 6 3 10M23 17c-4-5-2-9 1-11 4 2 5 6 3 10M10 32c2-6 7-7 10-4-1 4-5 7-10 4Z"/>',
  scroll: '<path d="M6 7h25c3 0 4 2 4 5v22H12c-4 0-7-2-7-5 0-3 2-5 6-5h18M12 13h17M12 20h15M12 27h12"/>',
  chrysanthemum: '<path d="M20 35V8M7 15c7 2 10 6 13 12M33 15c-7 2-10 6-13 12M7 29c6-5 9-6 13-4M33 29c-6-5-9-6-13-4"/>',
  pine: '<path d="M6 35C11 24 19 13 35 5"/><path d="M12 27l-5-4M18 20l-5-4M25 14l-5-4M16 30l7-9M23 23l7-9M30 16l5-7"/>',
  ripple: '<path d="M4 13c4-4 8-4 12 0s8 4 12 0 8-4 8 0M4 23c4-4 8-4 12 0s8 4 12 0 8-4 8 0M4 33c4-4 8-4 12 0s8 4 12 0"/>',
  moon: '<path d="M28 6a13 13 0 1 0 4 25A15 15 0 0 1 28 6Z"/><path d="M5 33c5-5 10-5 15 0s10 5 16 0"/>',
  mountain: '<path d="M3 34 13 20l6 7 8-14 10 21M8 34l8-8 7 8M20 34l7-9 9 9"/>',
}

export const COVER_MOTIFS = {
  wedding: '<svg class="cover-motif" viewBox="0 0 120 160" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="48" cy="76" r="30"/><circle cx="72" cy="76" r="30"/><path d="M28 47c-9-7-17-6-23 1M92 47c9-7 17-6 23 1M31 108c-9 7-15 15-13 24M89 108c9 7 15 15 13 24"/></svg>',
  birthday: '<svg class="cover-motif" viewBox="0 0 120 160" fill="none" stroke="currentColor" aria-hidden="true"><path d="M60 115V42M44 115c2-25 8-43 16-58M76 115c-2-25-8-43-16-58M26 83c13-1 23 5 30 16M94 83c-13-1-23 5-30 16"/><circle cx="60" cy="69" r="30"/><circle cx="60" cy="69" r="21"/></svg>',
  fullmoon: '<svg class="cover-motif" viewBox="0 0 120 160" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="60" cy="70" r="40"/><circle cx="60" cy="70" r="31"/><path d="M13 98c12-11 24-11 36 0s24 11 36 0 24-11 28 0M17 110c11-9 22-9 33 0s22 9 33 0 20-9 25 0"/></svg>',
  housewarming: '<svg class="cover-motif" viewBox="0 0 120 160" fill="none" stroke="currentColor" aria-hidden="true"><path d="M20 68 60 32l40 36v49H20Z"/><path d="M38 117V76h44v41M38 88h44M60 76v41M20 68h80"/><path d="M31 54h58"/></svg>',
  school: '<svg class="cover-motif" viewBox="0 0 120 160" fill="none" stroke="currentColor" aria-hidden="true"><path d="M21 45c14-7 27-5 39 5 12-10 25-12 39-5v70c-14-7-27-5-39 5-12-10-25-12-39-5Z"/><path d="M60 50v70M31 61c8-2 14-1 20 2M31 74c8-2 14-1 20 2M31 87c8-2 14-1 20 2M69 63c6-3 12-4 20-2M69 76c6-3 12-4 20-2M69 89c6-3 12-4 20-2"/></svg>',
  funeral: '<svg class="cover-motif" viewBox="0 0 120 160" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="60" cy="78" r="16"/><path d="M60 111V94M60 62V45M34 78h17M69 78h17M42 60l12 12M66 84l12 12M42 96l12-12M66 72l12-12M23 52c11 5 22 9 37 10M97 52c-11 5-22 9-37 10"/></svg>',
  baishi: '<svg class="cover-motif" viewBox="0 0 120 160" fill="none" stroke="currentColor" aria-hidden="true"><path d="M31 49c0-16 13-25 29-25s29 9 29 25v82H31Z"/><path d="M43 49c0-9 7-15 17-15s17 6 17 15M31 76h58M48 93h24M60 61v15"/></svg>',
  memorial: '<svg class="cover-motif" viewBox="0 0 120 160" fill="none" stroke="currentColor" aria-hidden="true"><path d="M43 114h34M49 114c0-22 2-38 2-51M71 114c0-18-2-36-2-51"/><path d="M51 63c-8-16-2-28 7-35 0 10 5 16 11 21M66 49c9-13 7-26-1-35-2 12-8 18-14 23"/><path d="M33 122h54"/></svg>',
  anniversary: '<svg class="cover-motif" viewBox="0 0 120 160" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="60" cy="77" r="38"/><circle cx="60" cy="77" r="28"/><circle cx="60" cy="77" r="18"/><path d="M60 39v12M60 103v12M22 77h12M86 77h12M33 50l9 9M78 95l9 9M33 104l9-9M78 59l9-9"/></svg>',
  reburial: '<svg class="cover-motif" viewBox="0 0 120 160" fill="none" stroke="currentColor" aria-hidden="true"><path d="m12 112 24-36 15 18 19-36 22 32 16-20 10 42"/><path d="m24 112 18-20 16 20M58 112l15-20 17 20M18 127h84"/><path d="M38 54c9-8 19-9 28-3 9-6 19-5 26 2"/></svg>',
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

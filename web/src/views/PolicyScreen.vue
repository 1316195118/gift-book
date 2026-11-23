<template>
  <main class="policy-page" :class="{ 'is-privacy': page.kind === 'privacy' }">
    <header class="policy-topbar">
      <a class="policy-brand" href="/" aria-label="返回电子礼簿首页">
        <span class="policy-seal">礼</span>
        <span>电子礼簿</span>
      </a>
      <nav aria-label="站点信息">
        <a href="/terms" :aria-current="page.kind === 'terms' ? 'page' : undefined">服务条款</a>
        <a href="/privacy" :aria-current="page.kind === 'privacy' ? 'page' : undefined">隐私政策</a>
      </nav>
    </header>

    <article class="policy-paper">
      <p class="policy-kicker">{{ page.kicker }}</p>
      <h1>{{ page.title }}</h1>
      <p class="policy-lead">{{ page.lead }}</p>
      <p class="policy-updated">更新日期：2026 年 11 月 23 日</p>

      <section v-for="(section, index) in page.sections" :key="section.title" class="policy-section">
        <h2><span>{{ String(index + 1).padStart(2, '0') }}</span>{{ section.title }}</h2>
        <template v-for="(paragraph, pIndex) in section.paragraphs" :key="pIndex">
          <p v-if="typeof paragraph === 'string'">{{ paragraph }}</p>
          <ul v-else>
            <li v-for="item in paragraph" :key="item">{{ item }}</li>
          </ul>
        </template>
      </section>

      <aside class="policy-note">
        <b>{{ page.noteTitle }}</b>
        <p>{{ page.note }}</p>
      </aside>

      <footer class="policy-footer">
        <a class="policy-back" href="/">← 返回电子礼簿首页</a>
        <span v-if="page.kind === 'terms'"><a href="/privacy">查看隐私政策</a></span>
        <span v-else><a href="/terms">查看服务条款</a></span>
      </footer>
    </article>
  </main>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  kind: { type: String, default: 'terms' },
})

const terms = {
  kind: 'terms',
  kicker: 'TERMS OF SERVICE',
  title: '服务条款',
  lead: '请在创建或管理礼簿前阅读本条款。本条款说明电子礼簿可以怎样使用、数据由谁负责，以及出现问题时如何处理。',
  sections: [
    {
      title: '服务说明',
      paragraphs: [
        '电子礼簿是一款用于红白事礼金或奠仪记录、统计、查询与导出的自托管工具。具体功能、可访问范围和可用时间由部署和维护本站的个人或组织决定。',
        '本站不替用户保管现金，不参与付款、退款或收款争议，也不保证纸质原件、第三方收款平台或网络服务始终可用。',
      ],
    },
    {
      title: '账户与访问凭证',
      paragraphs: [
        '你应妥善保管管理员密码、家庭访问码、账簿管理密码和宾客登记链接，不得向无关人员披露。通过有效凭证完成的查看、修改、删除或导出操作，视为获授权操作。',
        '如发现凭证泄露、异常登录或数据被误改，请立即修改相关密码、退出设备会话，并联系站点维护者。',
      ],
    },
    {
      title: '使用规范',
      paragraphs: [['不得利用本站实施违法活动、侵犯他人隐私或名誉，也不得未经授权查看、修改或导出他人的账簿。', '不得绕过访问控制、批量探测密码、上传恶意代码或以影响多人正常使用的方式发起压测、爬取或攻击。', '录入内容应真实、必要且与礼簿记录相关。涉及未成年人、病患或其他敏感个人信息时，应确保你有合法、适当的处理依据。']],
    },
    {
      title: '用户内容与知识产权',
      paragraphs: [
        '账簿名称、时间、地点、礼金记录、备注、封面图和备份等由用户提供或生成，相关权利归用户或原权利人所有。你需要确保上传内容不侵犯他人权益。',
        '本站软件、界面、品牌标识和说明文档受适用法律保护。开源部分依照仓库许可证使用；未经许可，不得将本站品牌或界面用于误导性宣传。',
      ],
    },
    {
      title: '数据、备份与删除',
      paragraphs: [
        '用户应自行确认备份是否成功，并定期导出留底。设备故障、误删除、密码遗忘、存储损坏或未配置备份可能导致数据无法恢复。',
        '账簿中的礼金明细按产品设计以加密形式保存；管理密码或账簿密码遗忘时，维护者通常无法代为恢复。删除账簿、清空备份或移除部署数据后，相关数据可能无法找回。',
      ],
    },
    {
      title: '服务变更与免责',
      paragraphs: [
        '维护者可根据安全、合规或产品需要更新、暂停或停止部分功能，并尽可能提前告知。自行部署版本由部署者自行维护和升级。',
        '在法律允许的范围内，对于因网络中断、设备故障、第三方服务、不可抗力、用户误操作或凭证泄露造成的间接损失，本站不承担超出法定范围的责任。本条不排除依法不能排除的责任。',
      ],
    },
    {
      title: '条款更新与争议处理',
      paragraphs: [
        '条款发生重要变化时，会更新页面顶部的日期。继续使用本站，表示你接受更新后的条款。',
        '争议应先与实际运营或部署本站的主体友好协商。协商不成的，可依法向该运营主体所在地有管辖权的人民法院提起诉讼；法律另有强制规定的，从其规定。',
      ],
    },
  ],
  noteTitle: '需要帮助？',
  note: '本站可能是私人或家庭自托管服务，请优先联系向你提供访问地址、管理员密码或部署支持的人。',
}

const privacy = {
  kind: 'privacy',
  kicker: 'PRIVACY POLICY',
  title: '隐私政策',
  lead: '电子礼簿以自托管和加密记录为核心。本页用通俗语言说明本站会处理哪些信息、为什么处理、保存在哪里，以及你可以怎样管理这些信息。',
  sections: [
    {
      title: '本站会处理哪些信息',
      paragraphs: [['访问与安全信息：用于登录、会话、防暴力尝试和故障排查的访问时间、IP 地址、设备或浏览器信息、操作记录和错误日志。', '账户与家庭信息：管理员认证状态、家庭名称、家庭访问设置、账簿名称、日期、地点、模板和加密后的账簿内容。', '账簿记录：来宾姓名、礼金或奠仪金额、关系、收款方式、备注、回礼记录和修改痕迹。核心明细按产品设计以加密形式保存在部署环境中。', '宾客登记：启用宾客登记时，宾客通过临时链接提交的姓名、金额、关系与留言会先在服务端暂存，主家确认后才转为加密账簿记录。', '用户主动上传：封面图、收款码、扫描照片和备份文件。扫描识别在本容器或部署环境中完成；本站不会因此自动把照片上传到第三方 OCR 服务。', '本地偏好：主题、字号、声音、更新代理、离线缓存等设置可能保存在浏览器或部署环境的配置目录中。']],
    },
    {
      title: '我们为什么处理这些信息',
      paragraphs: [['提供礼簿创建、登记、查询、统计、协作、打印与导出功能。', '验证访问权限，防止未授权查看、暴力登录、重复提交和异常操作。', '完成自动备份、故障恢复、安全审计和版本更新。', '在你主动操作时生成二维码、导出文件或进行本地 OCR 识别。']],
    },
    {
      title: '数据保存在哪里',
      paragraphs: [
        '电子礼簿默认部署在用户自己的服务器、NAS 或电脑上。账簿数据、配置和备份通常位于部署者指定的 data、config 或备份目录，不会因为使用本站而自动进入我们的云端账户。',
        '浏览器可能保存登录会话、主题偏好、离线页面和尚未同步的录入。服务端可能保存审计日志、自动备份和家庭配置。实际保存位置与保留时间由部署者配置。',
      ],
    },
    {
      title: '第三方服务、分析与 Cookie',
      paragraphs: [
        '本项目未内置广告、用户画像或第三方流量分析脚本，也不会把礼金明细出售或提供给广告平台。',
        '程序更新会按设置访问 GitHub Container Registry；若使用代理，代理服务可能看到连接元数据。字体使用设备本地字体，不向字体 CDN 发起请求。用户主动打开外部链接时，目标网站将按其自己的隐私政策处理信息。',
        '本站主要使用必要的 Cookie 或本地存储维持登录和偏好，不用于跨站广告追踪。',
      ],
    },
    {
      title: '共享、保留与安全',
      paragraphs: [
        '共享范围取决于你创建的账簿、家庭和宾客登记链接。管理员或获授权家庭成员可能查看、导出或恢复相关数据；使用共享设备时请及时退出并清理离线缓存。',
        '部署者应只保留实现服务、安全和备份所需的信息，并设置合理备份周期与删除策略。发生安全事件时，应及时隔离实例、修改凭证并评估通知受影响的用户。',
        '本站采用访问控制、加密记录、会话与审计等安全措施，但任何系统都无法保证绝对安全。请不要在备注中填写与礼簿目的无关的高度敏感信息。',
      ],
    },
    {
      title: '你的选择与权利',
      paragraphs: [['查看或更正账簿信息，并按照产品能力保留修改痕迹。', '删除账簿、宾客临时登记、收款码、封面或备份，但删除后可能无法恢复。', '关闭宾客登记、退出设备会话或调整家庭访问范围。', '请求实际运营本站的部署者说明日志保留、备份或删除方式。依法提出访问、更正、删除等请求时，请通过部署者提供的联系方式联系。']],
    },
    {
      title: '未成年人、跨境与政策更新',
      paragraphs: [
        '本站不以未成年人为独立目标用户。未成年人应在监护人指导下使用。由于本站通常为自托管，是否会向境外传输信息取决于部署者和所用网络服务；部署者应自行完成必要的合规评估。',
        '政策发生重要变化时会更新本页日期。若你不同意更新后的政策，应停止使用并联系部署者处理相关数据。',
      ],
    },
  ],
  noteTitle: '隐私请求找谁？',
  note: '电子礼簿可能由个人、家庭或组织自行部署。请优先联系向你提供访问地址的部署者；如果页面明确标示了运营主体，也可通过该主体公布的渠道提出请求。',
}

const page = computed(() => (props.kind === 'privacy' ? privacy : terms))

</script>

<style scoped>
.policy-page {
  --policy-ink: #281c13;
  --policy-muted: #665846;
  --policy-paper: #fffaf1;
  --policy-line: #e4d4ba;
  min-height: 100vh;
  padding: 0 24px 64px;
  color: var(--policy-ink);
  background:
    radial-gradient(circle at 12% 0%, rgb(176 135 61 / .14), transparent 31rem),
    radial-gradient(circle at 92% 15%, rgb(171 43 33 / .08), transparent 28rem),
    #faf4e9;
}
.is-privacy {
  background:
    radial-gradient(circle at 8% 0%, rgb(78 107 99 / .11), transparent 30rem),
    radial-gradient(circle at 95% 12%, rgb(51 71 90 / .07), transparent 28rem),
    #f2f3f2;
}
.policy-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: min(900px, 100%);
  min-height: 76px;
  margin: 0 auto;
  border-bottom: 1px solid rgb(87 66 42 / .14);
}
.policy-brand,
.policy-topbar nav a,
.policy-footer a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}
.policy-brand {
  gap: 10px;
  font-family: var(--font-serif, serif);
  font-weight: 650;
  letter-spacing: .08em;
}
.policy-seal {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 4px;
  color: #fff8e9;
  background: #ab2b21;
  font-family: var(--font-kai, serif);
}
.policy-topbar nav {
  display: flex;
  gap: 12px;
}
.policy-topbar nav a {
  padding: 0 8px;
  color: var(--policy-muted);
  font-size: 13px;
}
.policy-topbar nav a[aria-current="page"] {
  color: #8f241c;
  font-weight: 650;
  text-decoration: underline;
  text-underline-offset: 5px;
}
.policy-paper {
  width: min(900px, 100%);
  margin: 32px auto 0;
  padding: clamp(28px, 6vw, 64px);
  border: 1px solid var(--policy-line);
  border-radius: 16px;
  background: rgb(255 250 241 / .94);
  box-shadow: 0 24px 70px rgb(49 30 17 / .1);
}
.policy-kicker {
  color: #8a6426;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .22em;
}
h1 {
  margin: 10px 0 14px;
  font-family: var(--font-serif, serif);
  font-size: clamp(34px, 7vw, 56px);
  line-height: 1.2;
  letter-spacing: .08em;
}
.policy-lead {
  max-width: 48em;
  color: var(--policy-muted);
  font-size: 16px;
  line-height: 1.8;
}
.policy-updated {
  margin-top: 16px;
  color: #74624d;
  font-size: 12px;
}
.policy-section {
  margin-top: 34px;
  padding-top: 26px;
  border-top: 1px solid var(--policy-line);
}
.policy-section h2 {
  display: flex;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 14px;
  font-family: var(--font-serif, serif);
  font-size: 23px;
}
.policy-section h2 span {
  color: #ab2b21;
  font: 12px var(--font-ui, sans-serif);
  letter-spacing: .12em;
}
.policy-section p,
.policy-section li {
  color: #514434;
  font-size: 15px;
  line-height: 1.9;
}
.policy-section p + p {
  margin-top: 10px;
}
.policy-section ul {
  display: grid;
  gap: 8px;
  padding-left: 1.25em;
  list-style: disc;
}
.policy-section li::marker {
  color: #ab2b21;
}
.policy-note {
  margin-top: 36px;
  padding: 18px 20px;
  border-left: 3px solid #ab2b21;
  border-radius: 0 10px 10px 0;
  color: #514434;
  background: #f7ecdf;
}
.policy-note b {
  color: #8f241c;
}
.policy-note p {
  margin-top: 4px;
  font-size: 14px;
  line-height: 1.75;
}
.policy-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  margin-top: 36px;
  padding-top: 18px;
  border-top: 1px solid var(--policy-line);
  color: var(--policy-muted);
  font-size: 13px;
}
.policy-footer a {
  color: #7d291f;
  text-decoration: underline;
  text-underline-offset: 4px;
}
@media (max-width: 560px) {
  .policy-page { padding-inline: 14px; }
  .policy-topbar { align-items: flex-start; flex-direction: column; gap: 2px; padding: 10px 0; }
  .policy-paper { margin-top: 18px; padding: 26px 20px; border-radius: 12px; }
  .policy-section h2 { font-size: 20px; }
  .policy-section p,
  .policy-section li { font-size: 14px; }
}
</style>

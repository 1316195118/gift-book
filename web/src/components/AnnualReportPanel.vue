<template>
  <div class="gb-annual-report">
    <div class="gb-insight-hero report-cover">
      <div>
        <span class="gb-insight-kicker">年度人情报告 · {{ report.year }}</span>
        <h3>{{ eventName }}</h3>
        <p>按礼金登记年份统计，帮你回看这一年的往来结构、回礼进度与重点人情。</p>
      </div>
      <label class="gb-year-picker">报告年份
        <select v-model.number="year">
          <option v-for="option in years" :key="option" :value="option">{{ option }} 年</option>
        </select>
      </label>
    </div>

    <div v-if="report.recordCount" class="gb-report-metrics">
      <div class="primary"><span>年度礼金</span><b>{{ formatCurrency(report.totalAmount) }}</b><small>{{ report.recordCount }} 笔 · {{ report.peopleCount }} 位来宾</small></div>
      <div><span>已回礼</span><b>{{ formatCurrency(report.returnedAmount) }}</b><small>{{ report.returnedRecordCount }} 笔有回礼记录</small></div>
      <div><span>净人情</span><b>{{ formatCurrency(report.netAmount) }}</b><small>年度累计礼金减去已回礼</small></div>
      <div><span>平均往来</span><b>{{ formatCurrency(report.average) }}</b><small>{{ report.peakMonth ? `${report.peakMonth.label}最集中` : '暂无峰值' }}</small></div>
    </div>

    <div v-if="report.recordCount" class="gb-report-grid">
      <section class="gb-report-card is-wide">
        <div class="gb-report-head"><h4>全年礼金节奏</h4><span>{{ report.peakMonth ? `峰值 ${report.peakMonth.label} · ${formatCurrency(report.peakMonth.amount)}` : '' }}</span></div>
        <div class="gb-month-chart">
          <div v-for="month in report.monthly" :key="month.month" class="gb-month-column">
            <span class="gb-month-value">{{ month.amount ? formatCompact(month.amount) : '' }}</span>
            <i><b :style="{ height: `${Math.max(month.amount ? 5 : 0, month.amount / maxMonth * 100)}%` }"></b></i>
            <span>{{ month.label }}</span>
          </div>
        </div>
      </section>
      <section class="gb-report-card">
        <div class="gb-report-head"><h4>关系结构</h4><span>{{ report.relations.length }} 类</span></div>
        <div class="gb-report-bars">
          <div v-for="relation in report.relations.slice(0, 7)" :key="relation.relation">
            <span>{{ relation.relation }}</span>
            <i><b :style="{ width: `${relation.cents / maxRelation * 100}%` }"></b></i>
            <strong>{{ formatCompact(relation.cents / 100) }}</strong>
          </div>
        </div>
      </section>
      <section class="gb-report-card">
        <div class="gb-report-head"><h4>重点往来</h4><span>金额 Top {{ Math.min(10, report.topPeople.length) }}</span></div>
        <ol class="gb-report-people">
          <li v-for="(person, index) in report.topPeople" :key="person.name">
            <span>{{ index + 1 }}</span><b>{{ person.name }}</b><em>{{ person.count }} 笔</em><strong>{{ formatCurrency(person.cents / 100) }}</strong>
          </li>
        </ol>
      </section>
    </div>
    <div v-else class="gb-review-empty">
      <span aria-hidden="true">年</span>
      <b>{{ report.year }} 年还没有礼金记录</b>
      <p>切换其他年份，或继续录入后回来生成报告。</p>
    </div>

    <div class="gb-report-footer">
      <p>报告在本机生成，不会上传姓名、金额或关系数据。</p>
      <button type="button" class="modal-btn-primary" :disabled="!report.recordCount" @click="printReport">打印 / 保存为 PDF</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { state as st } from '../store.js'
import { formatCurrency } from '../lib/format.js'
import { buildRelationshipReport, reportYears } from '../lib/relationship-report.js'

const yearsFromData = reportYears(st.gifts)
const currentYear = new Date().getFullYear()
const years = yearsFromData.length ? yearsFromData : [currentYear]
const year = ref(years[0])
const eventName = computed(() => st.currentEvent?.name || '礼簿')
const report = computed(() => buildRelationshipReport(st.gifts, year.value))
const maxMonth = computed(() => Math.max(1, ...report.value.monthly.map((month) => month.amount)))
const maxRelation = computed(() => Math.max(1, ...report.value.relations.map((relation) => relation.cents)))

function formatCompact(value) {
  const amount = Number(value) || 0
  if (amount >= 10000) return `${(amount / 10000).toFixed(amount >= 100000 ? 0 : 1)}万`
  return amount ? `¥${Math.round(amount).toLocaleString('zh-CN')}` : ''
}

function printReport() {
  const rows = report.value.relations.map((item) => `<tr><td>${escape(item.relation)}</td><td>${item.people} 人 / ${item.count} 笔</td><td>${formatCurrency(item.cents / 100)}</td></tr>`).join('')
  const people = report.value.topPeople.map((person, index) => `<tr><td>${index + 1}</td><td>${escape(person.name)}</td><td>${person.count} 笔</td><td>${formatCurrency(person.cents / 100)}</td></tr>`).join('')
  const markup = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(eventName.value)} · ${report.value.year} 年度人情报告</title><style>
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{margin:0;color:#2b211d;font:14px/1.6 "Noto Serif SC","Songti SC",serif}h1{margin:0;font-size:28px}h2{margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid #ccb9a8;font-size:18px}.head{padding:22px;border:1px solid #b58d69;background:#faf4eb}.head p{margin:6px 0 0;color:#6c5b50}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px}.metrics div{padding:12px;border:1px solid #dacab9}.metrics span,.metrics small{display:block;color:#746458}.metrics b{display:block;margin:4px 0;color:#9f2f28;font-size:20px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e2d6ca;text-align:left}th{background:#f5eee6}footer{margin-top:24px;color:#8b796c;font-size:11px}.no-print{position:fixed;right:20px;top:20px;padding:10px 16px;border:0;background:#9f2f28;color:white;cursor:pointer}@media print{.no-print{display:none}}</style></head><body><button class="no-print" onclick="print()">打印 / 保存 PDF</button><header class="head"><h1>${escape(eventName.value)}</h1><p>${report.value.year} 年度人情报告 · 本机生成</p><div class="metrics"><div><span>年度礼金</span><b>${formatCurrency(report.value.totalAmount)}</b><small>${report.value.recordCount} 笔</small></div><div><span>来宾</span><b>${report.value.peopleCount} 位</b><small>平均 ${formatCurrency(report.value.average)}</small></div><div><span>已回礼</span><b>${formatCurrency(report.value.returnedAmount)}</b><small>${report.value.returnedRecordCount} 笔</small></div><div><span>净人情</span><b>${formatCurrency(report.value.netAmount)}</b><small>待回 ${report.value.unreturnedRecordCount} 笔</small></div></div></header><h2>关系结构</h2><table><thead><tr><th>关系</th><th>人数 / 笔数</th><th>金额</th></tr></thead><tbody>${rows}</tbody></table><h2>重点往来</h2><table><thead><tr><th>#</th><th>姓名</th><th>笔数</th><th>累计</th></tr></thead><tbody>${people}</tbody></table><footer>隐私说明：本报告仅使用当前账簿已解密数据，在浏览器内生成；打印文件请妥善保管。</footer></body></html>`
  const url = URL.createObjectURL(new Blob([markup], { type: 'text/html;charset=utf-8' }))
  // 部分浏览器在传入 noopener 特性时会返回 null，导致这里误判为拦截并立刻释放 Blob。
  // 先取得窗口引用，再主动断开 opener，既保持隔离又确保打印页能加载。
  const printWindow = window.open(url, '_blank')
  if (!printWindow) {
    URL.revokeObjectURL(url)
    return
  }
  printWindow.opener = null
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  printWindow.focus()
}

function escape(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}
</script>

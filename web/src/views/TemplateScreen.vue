<template>
  <div id="template-screen" class="home-screen-wrap">
    <div class="home-inner">
      <div class="back-link" @click="showHome">← 返回首页</div>
      <div class="home-hero">
        <div class="hero-copy">
          <div class="eyebrow" id="tpl-eyebrow">{{ catText.tplEyebrow }}</div>
          <h1 id="tpl-title">选择模板</h1>
          <div class="sub" id="tpl-sub">选一个最接近的场景，名称与封面会自动带出，之后仍可随时修改。</div>
        </div>
      </div>
      <div id="template-grid" class="tpl-grid">
        <div
          v-for="template in templates"
          :key="template.key"
          class="tpl-card"
          :data-tpl="template.key"
          role="button"
          tabindex="0"
          :aria-label="`使用${template.name}模板`"
          @click="select(template.key)"
          @keydown.enter.prevent="select(template.key)"
          @keydown.space.prevent="select(template.key)"
        >
          <div class="tpl-cover" v-html="coverFor(template.key)"></div>
          <div class="tpl-body">
            <div class="tpl-tag">{{ template.sub }}</div>
            <h3>{{ template.name }}</h3>
            <p>{{ template.desc }}</p>
            <div class="use">使用此模板</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { state as st } from '../store.js'
import { CATEGORY_TEXT, templatesFor } from '../lib/content.js'
import { renderCoverMarkup } from '../lib/cover.js'
import { showHome, showSetup } from '../bootstrap.js'

const catText = computed(() => CATEGORY_TEXT[st.homeCategory])
const templates = computed(() => templatesFor(st.homeCategory))
const isSolemn = computed(() => st.homeCategory === 'white')

const coverFor = (key) =>
  renderCoverMarkup(
    { theme: isSolemn.value ? 'theme-solemn' : 'theme-festive', template: key },
    true,
    st.homeCategory,
  )

function select(key) {
  showSetup({ template: key })
}
</script>

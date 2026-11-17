import pluginVue from 'eslint-plugin-vue'
import noUnsanitized from 'eslint-plugin-no-unsanitized'

// 轻量门禁：只拦真实错误（未使用变量、Vue 模板结构问题），不做格式强制，
// 避免一次性重排全仓产生海量 diff。
export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  {
    plugins: { 'no-unsanitized': noUnsanitized },
    rules: {
      // innerHTML / insertAdjacentHTML 必须经过转义；已人工核对过的位置逐行豁免。
      'no-unsanitized/property': ['error', { escape: { taggedTemplates: ['escapeHtml'] } }],
      'no-unsanitized/method': 'error',
    },
  },
  {
    files: ['e2e/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly' },
    },
    rules: { 'no-console': 'off', 'no-undef': 'off' },
  },
  ...pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        performance: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        crypto: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        MouseEvent: 'readonly',
        HTMLElement: 'readonly',
        Image: 'readonly',
        matchMedia: 'readonly',
        getComputedStyle: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        structuredClone: 'readonly',
        indexedDB: 'readonly',
        requestIdleCallback: 'readonly',
        // Vue <script setup> 编译宏，不需要 import。
        // 内嵌的第三方 OCR 代码带 UMD 判断，会出现 typeof module 之类。
        module: 'readonly',
        exports: 'readonly',
        defineProps: 'readonly',
        defineEmits: 'readonly',
        defineExpose: 'readonly',
        defineOptions: 'readonly',
        withDefaults: 'readonly',
      },
    },
    rules: {
      // 大量 v-html 是刻意的模板渲染（内容已转义），不当作缺陷。
      'vue/no-v-html': 'off',
      'vue/multi-word-component-names': 'off',
      // 格式类规则全部交给编辑器，不在门禁里制造噪声。
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/attributes-order': 'off',
      'vue/require-default-prop': 'off',
      // 漏 import 的标识符在浏览器里才报错，必须在这一层拦住。
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
  },
]

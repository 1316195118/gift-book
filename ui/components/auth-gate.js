// 访问验证闸门（原生 JS，零第三方依赖）。验证成功后关闭闸门并跳过鉴权重试。
import { state as st } from '../store.js'
import { api } from '../lib/api.js'
import { bootstrap } from '../bootstrap.js'
import { success } from '../lib/feedback.js'

export function mountAuthGate(root) {
  root.innerHTML = `
    <div class="auth-gate">
      <div class="auth-card">
        <div class="auth-seal" aria-hidden="true">礼</div>
        <h1>访问验证</h1>
        <p>请输入访问密码，验证后进入礼簿。</p>
        <form id="auth-form">
          <label class="sr-only" for="auth-password">访问密码</label>
          <input type="password" id="auth-password" placeholder="访问密码" autocomplete="current-password" required />
          <div class="auth-error hidden" id="auth-error" role="alert"></div>
          <button type="submit" id="auth-submit">进入礼簿</button>
        </form>
        <p class="auth-note">访问密码由部署者设置，与单本账簿的管理密码不同。登录状态保留 7 天。</p>
      </div>
    </div>`

  const form = root.querySelector('#auth-form')
  const input = root.querySelector('#auth-password')
  const errorEl = root.querySelector('#auth-error')
  const submitBtn = root.querySelector('#auth-submit')

  const submit = async (e) => {
    e.preventDefault()
    const password = input.value
    if (!password || submitBtn.disabled) return
    submitBtn.disabled = true
    submitBtn.textContent = '验证中…'
    errorEl.classList.add('hidden')
    errorEl.textContent = ''
    try {
      const result = await api.login(password)
      if (result.success && result.authenticated) {
        input.value = ''
        st.authGate = false
        success('验证通过', { detail: '欢迎回来', duration: 2200 })
        bootstrap({ skipAuth: true })
      } else {
        errorEl.textContent = result.message || '访问密码不正确'
        errorEl.classList.remove('hidden')
      }
    } catch (err) {
      errorEl.textContent = err.message || '访问密码不正确'
      errorEl.classList.remove('hidden')
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = '进入礼簿'
    }
  }

  form.addEventListener('submit', submit)
}

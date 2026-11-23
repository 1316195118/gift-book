// 扫描已跟踪与未忽略的新文件中的常见密钥格式。输出只给文件与行号，绝不打印命中值。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['bearer-literal', /\bBearer\s+[A-Za-z0-9._~+/-]{24,}={0,2}/],
  ['url-credential', /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@/],
]

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
const findings = []

for (const file of files) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    // CI 的 secrets 表达式和环境变量引用不是硬编码凭证。
    if (line.includes('${{ secrets.') || line.includes('process.env.') || line.includes('os.Getenv(')) return
    for (const [kind, pattern] of patterns) {
      if (pattern.test(line)) findings.push({ file, line: index + 1, kind })
    }
  })
}

if (findings.length) {
  for (const item of findings) console.error(`${item.file}:${item.line}  ${item.kind}`)
  console.error(`发现 ${findings.length} 处疑似硬编码凭证；值已省略，请改为服务端环境变量。`)
  process.exit(1)
}

console.log(`已扫描 ${files.length} 个工作区文件，未发现硬编码 API Key、私钥或带凭据 URL。`)

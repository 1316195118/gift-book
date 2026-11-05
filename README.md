# 电子礼簿 · Gift Book

红白喜事礼金登记，数据全部保存在本机。单文件或单容器即可运行：内嵌前端、纯 JSON 存储，无数据库、无外部服务、无需注册。

> 由旧版（PHP 单页）重写而来：界面与流程保持一致，后端改为 Go，前端改为 Vue 3。

## 特性

- **隐私优先**：礼金在浏览器端加密后上传，服务端只存密文，不接触明文
- **红白双主题**：红事「囍」、白事「奠」两套配色与封面，互不串色
- **竖排礼簿**：传统竖排，金额实时转大写，同名 / 同额自动提醒
- **封面模板**：模板 5 + 5，封面 9 款，CSS / SVG 现画，不含图片素材
- **记录留痕**：只改不删，每次纠错留快照，详情可看时间轴
- **导出打印**：Excel 明细、A4 横向 PDF、Word；字号与页边距可调
- **扫描录入**：可选 OCR，拍照识别后加密导入
- **离线可用**：断网暂存，恢复后按 `requestId` 去重补传
- **安全防护**：整站访问密码 + 账簿管理密码 + IP 防爆破
- **备份迁移**：一键导出整站 zip，换机即恢复

## 界面预览

| 红事首页 | 白事首页 |
| --- | --- |
| ![红事首页](docs/images/home-red.png) | ![白事首页](docs/images/home-white.png) |

| 新建账簿 | 记账页 |
| --- | --- |
| ![新建账簿](docs/images/setup.png) | ![记账页](docs/images/ledger.png) |

| 统计 | 手机端 |
| --- | --- |
| ![统计](docs/images/stats.png) | ![手机端](docs/images/mobile.png) |

---

## 快速开始

### 方式一：直接运行二进制

```bash
# Windows
giftbook.exe

# Linux x86_64
./giftbook-linux-amd64

# Linux ARM64（NAS、树莓派）
./giftbook-linux-arm64
```

浏览器打开 `http://<机器IP>:8099`，数据默认写到可执行文件旁的 `data/`。

### 方式二：Docker 部署

公开镜像已发布到 GitHub Container Registry，新建 `docker-compose.yml` 粘贴以下内容即可部署，无需下载源码：

```yaml
name: gift-book

services:
  gift-book:
    image: ghcr.io/1316195118/gift-book:alpine-20261106   # 公开镜像，免登录直接拉取
    container_name: gift-book                               # 容器名
    user: "1000:10"                                         # 权限：以 UID:GID 运行（绿联 UGOS Pro 首用户为 1000:10）
    ports:
      - "8099:8099"                                         # 宿主机:容器 端口映射
    environment:
      - TZ=Asia/Shanghai                                    # 时区
      # - GIFTBOOK_SETUP_TOKEN=change-me                    # 首次开启访问保护时要求的口令
      # - GIFTBOOK_TRUST_PROXY=1                            # 位于受信任反向代理后开启
    command:
      - -addr
      - 0.0.0.0                                             # 监听地址（接受局域网访问）
      - -port
      - "8099"                                              # 监听端口
      - -data
      - /data                                               # 账簿数据目录（容器内）
      - -config
      - /config                                             # 访问保护配置目录（容器内）
    restart: unless-stopped                                 # 容器策略：开机自启 + 异常重启
    volumes:
      - /volume1/docker/gift-book/data:/data                # 账簿数据持久化
      - /volume1/docker/gift-book/config:/config            # 访问保护配置持久化
    deploy:
      resources:
        limits:
          cpus: "2"                                         # CPU 核数上限
          memory: 512M                                      # 内存上限
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8099/api/ping"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

```bash
docker compose up -d
```

浏览器打开 `http://<机器IP>:8099`。

- 镜像标签 `alpine-20261106` 与 `latest` 指向同一版：带 shell 与 `wget` 的 Alpine 精简镜像，健康检查开箱即用。
- 普通 Linux / Windows / 其他 NAS：把 `volumes` 两行改成 `./data:/data`、`./config:/config`，删掉 `user` 行，`deploy` 一段可整体删除。
- 账簿数据与访问保护配置分别持久化在数据、配置两个目录，升级容器不会丢数据：

| 容器目录 | 宿主机目录 | 用途 |
| --- | --- | --- |
| `/data` | `/volume1/docker/gift-book/data` | 账簿数据 |
| `/config` | `/volume1/docker/gift-book/config` | 访问保护配置 |

也可以直接用 `docker run`：

```bash
docker run -d --name gift-book \
  -p 8099:8099 \
  -v "$(pwd)/data:/data" \
  -v "$(pwd)/config:/config" \
  -e TZ=Asia/Shanghai \
  --restart unless-stopped \
  ghcr.io/1316195118/gift-book:alpine-20261106
```

如需自行构建镜像（需要 Docker，Dockerfile 会自动安装前端依赖、编译 Go 并产出镜像）：

```bash
git clone https://github.com/1316195118/gift-book.git
cd gift-book
docker build -t gift-book:latest .
```

### 方式三：从源码构建

需要 Go 1.24+ 与 Node 20+：

```bash
build.bat          # Windows：安装依赖 → 构建前端 → 编译 giftbook.exe
./build.sh         # Linux/macOS
```

或分步：

```bash
cd web && npm install && npm run build && cd ..
node scripts/build.mjs        # 同步产物并编译
```

### 常用参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-port` | `8099` | 监听端口 |
| `-addr` | `0.0.0.0` | 监听地址，只给本机用可设 `127.0.0.1` |
| `-data` | 可执行文件旁的 `data/` | 数据目录 |
| `-config` | 同数据目录 | 访问保护配置目录 |
| `-open` | 关闭 | 启动后自动打开浏览器 |
| `-version` | — | 打印版本 |

环境变量 `GIFTBOOK_DATA_DIR` / `GIFTBOOK_CONFIG_DIR` 等价于对应参数。

---

## 数据与安全

### 存储

纯 JSON 文件，可直接指向旧版 PHP 部署的 `data/` 目录，**旧数据无需迁移**：

```
data/
├── events.json                   账簿清单
├── gifts_<eventId>.json          单本账簿的礼金（只含密文）
├── .trash/                       删除的账簿、导入前的旧数据
├── auth-state.json               访问保护状态
└── auth-throttle.json            登录失败计数
```

每次写入都是「写临时文件 → fsync → 原子改名」，断电最多回到上一版完整文件。

### 加密

- 礼金内容由**浏览器**用管理密码加密后上传，服务端只存密文，从不接触明文。
- v2 格式：PBKDF2-SHA256(310k) 派生密钥 → AES-256-CBC + HMAC-SHA256（先加密后认证）。
- 旧版 `Salted__`（EVP_BytesToKey/MD5）密文仍可解开，打开账簿后逐笔自动升级。
- 管理密码丢失无法恢复；接口从不回传可离线比对的摘要。

### 接口安全

- 所有写接口校验同源 `Origin`，跨站请求直接 403。
- 账簿钥匙走 `X-Ledger-Key` 请求头，服务端存 `HMAC-SHA256(钥匙, 每本随机盐)`。
- 访问密码与账簿钥匙的连续输错共用 IP 防爆破，锁定时间指数增长（1→30 分钟）。
- 静态资源与接口分离，API 一律 `no-store`。

首次部署时，从「未开启访问保护」到「开启」这一步默认无需额外验证，局域网内任何能打开页面的人都可以抢先设置密码。部署到不受信任的网络时，建议设置环境变量 `GIFTBOOK_SETUP_TOKEN`（任意足够长的口令）：设置后开启访问保护必须同时提供该口令，界面会显示「设置口令」输入框。位于受信任反向代理之后时，可再设 `GIFTBOOK_TRUST_PROXY=1` 让 `X-Forwarded-For` 参与防爆破与 Cookie 的 HTTPS 判断。

### 备份

页面「设置 → 数据备份」里导出 / 导入；也可直接打包数据目录：

```
tar czf giftbook-backup-$(date +%F).tgz data/
```

---

## 扫描礼簿（可选）

OCR 引擎不在二进制里。默认读取可执行文件旁的 `ocr/` 目录：

```
ocr/
├── recognize.py        # 输入图片路径，stdout 输出 {"success":true,"data":{"lines":[...]}}
└── venv/bin/python     # 或 Windows 的 venv\Scripts\python.exe
```

也可用环境变量 `GIFTBOOK_OCR_PYTHON`、`GIFTBOOK_OCR_SCRIPT` 指定。未配置时界面会明确提示「当前部署未内置 OCR」，其余功能不受影响。

---

## 目录结构

```
cmd/giftbook/        Go 入口（参数、嵌入资源、优雅退出）
internal/api/        HTTP 接口、静态资源、OCR 桥接、备份
internal/auth/       访问保护、Cookie、防爆破
internal/ledger/     账簿管理密码校验
internal/store/      JSON 文件存储（原子写、事务、回收站）
web/                 Vue 3 + Vite 前端源码
web/src/styles/      与旧版逐字节一致的四套 CSS
webapp/dist/         前端构建产物（Go embed 目录，构建时生成）
scripts/build.mjs    统一构建脚本
scripts/api-test.mjs 接口端到端测试
scripts/ui-check.mjs 无头浏览器界面验证
```

---

## 测试

```
node scripts/api-test.mjs      # 建账 / 加密礼金 / 并发保护 / 备份恢复 / 非法输入
node scripts/ui-check.mjs      # 22 项界面验证
node scripts/theme-sweep.mjs   # 红白两套主题逐页截图 + 串色 / 用词检查
node scripts/layout-audit.mjs  # 版面体检：重叠 / 挡字 / 裁切 / 隐形 / 素材不等大 / 对比度
node scripts/print-proof.mjs   # 打印打样：出 A4 横向 PDF + 分页图，查溢出与串色
node scripts/smoke.mjs <url>   # 只读冒烟，用来验线上部署（不建任何账簿）
```

`api-test.mjs` 会断言数据目录里只有它自己建的账簿，所以要对着一个空目录的实例跑：

```bash
./giftbook.exe -addr 127.0.0.1 -port 18299 -data /tmp/gb -config /tmp/gb &
BASE=http://127.0.0.1:18299 node scripts/api-test.mjs
```

`layout-audit.mjs` 把 13 个页面 / 弹窗 × 红白两套 × 桌面和手机两个宽度共 52 种组合走一遍，
按几何和计算样式找七类毛病，比肉眼翻截图稳。`print-proof.mjs` 可以用
`PRINT_FONT=xlarge PRINT_MARGIN=wide` 验证极端排版设置下版心不会被撑破。

### 部署到测试机

把程序推到一台 Proxmox 宿主机下的 LXC 容器里（容器中以 systemd 服务运行）：

```bash
PVE_HOST=192.168.1.10 GB_PW='<root 密码>' scripts/deploy-pve.sh
```

构建前端 → 交叉编译 linux/amd64 → scp 到宿主机 → `pct push` 进容器 → 重启服务。

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `PVE_HOST` | 是 | — | Proxmox 宿主机地址 |
| `GB_PW` | 是 | — | 宿主机 root 密码，只从环境变量读，不写进仓库 |
| `PVE_USER` | | `root` | 登录宿主机的用户 |
| `CT_ID` | | `100` | 目标 LXC 容器编号 |
| `REMOTE_BIN` | | `/opt/giftbook-go/giftbook` | 容器内的程序路径 |
| `SERVICE` | | `giftbook` | 容器内的 systemd 服务名 |
| `APP_URL` | | 不检查 | 设了就在更新后请求一次确认返回 200 |

两个界面脚本都通过 CDP 驱动浏览器，先开一个带调试端口的实例：

```bash
msedge --headless=new --remote-debugging-port=9334 --user-data-dir=/tmp/edge-ui about:blank
```

调界面时可以用 Vite 开发服务器对着已经跑起来的后端，省去每次重新编译：

```bash
GIFTBOOK_API=http://127.0.0.1:18099 npm run dev --prefix web
```

---

## 许可证

MIT。全部源码自写；OCR 引擎若使用 RapidOCR / ONNX Runtime，按其各自许可证单独授权。

## 自动备份

首页右上角「自动备份」可开启定时备份：按 1 小时 / 6 小时 / 12 小时 / 每天 / 每周把全部账簿打包成 zip，存到数据目录的 `backups/`，按设定份数自动清理旧文件，也可随时点「立即备份一份」或单独下载某一份。

设置存在配置目录的 `autobackup.json`，不含任何密钥。

## 界面定制

样式按职责分层，加载顺序就是层叠顺序（见 `web/src/main.js`），后面的文件只做加法：

| 文件 | 负责 |
| --- | --- |
| `styles/tokens.css` | 设计令牌：两套主题的色阶、字号、间距、圆角、动效曲线 |
| `styles/base.css` | 重置、排版、焦点环、可访问性 |
| `styles/atmosphere.css` | 纸张底纹与光、印章、进场与落印动效 |
| `styles/utilities.css` | 少量通用原子类 |
| `styles/components.css` | 按钮、输入框、弹窗、开关等公共组件 |
| `styles/screens.css` | 首页 / 模板页 / 创建页 / 记账页的版面 |
| `styles/cover.css` | 礼簿封面（屏幕、预览、打印共用一套） |
| `styles/ocr.css`、`styles/print.css` | 扫描界面、打印版式 |

改配色只动 `tokens.css`；改版面动 `screens.css`；改封面动 `cover.css`。

### 两套主题互不借色

红事取**洒金宣纸 + 朱砂 + 赤金**，白事取**素宣 + 青黛 + 素银**。
白事页面不出现红与金（连「删除」按钮也用暖炭色而非红色），红事页面不使用青黛系冷色 ——
石青虽然在传统彩画里与朱金同席，但它和白事主色太接近，会让人误以为打开错了账簿。

`node scripts/theme-sweep.mjs` 会把两套主题的 13 个页面与弹窗各走一遍，
自动检查**串色**（计算样式里出现对方主题的色相）和**用词**（白事页面出现喜庆字眼，或反之），
并逐页截图到 `.shots/sweep/`。

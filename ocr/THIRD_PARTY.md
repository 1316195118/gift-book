# OCR 第三方组件与许可证说明

本目录（`ocr/`）只包含**本项目自写的调用代码与依赖版本声明**，不包含任何第三方二进制或模型权重。真正的 OCR 技术栈全部来自上游第三方项目，且**不随本仓库分发**。

## 本目录内容（原创代码）

| 文件 | 作用 |
| --- | --- |
| `engine.py` | 模型加载、SHA256 完整性校验、构建期 manifest 生成 |
| `recognize.py` | 一次性 CLI：读取图片路径，向 stdout 输出 JSON，无网络监听 |
| `requirements.txt` | 固定的第三方依赖版本 |
| `THIRD_PARTY.md` | 本文件 |

## 第三方组件（不随仓库分发）

| 组件 | 版本 | 许可证 | 上游来源 | 说明 |
| --- | --- | --- | --- | --- |
| RapidOCR | 3.10.0 | Apache-2.0 | github.com/RapidAI/RapidOCR | OCR 编排框架 |
| PP-OCRv5（中文 mobile 版检测/识别）与 PP-OCRv4 方向分类模型 | — | Apache-2.0 | github.com/PaddlePaddle/PaddleOCR，由 RapidAI 转换为 ONNX | 模型权重，构建期获取 |
| ONNX Runtime | 1.23.2 | MIT | onnxruntime.ai（Microsoft） | 推理引擎 |
| opencv-python-headless | 4.12.0.88 | Apache-2.0 | opencv.org | 图像解码与预处理 |
| numpy | 2.2.6 | BSD-3-Clause | numpy.org | 数组运算 |
| Pillow | 12.0.0 | MIT-CMU / HPND | python-pillow.org | 图像打开与方向校正 |

## 分发与获取方式

- 模型权重与 Python 虚拟环境（`venv/`）体积大且各有许可，已通过仓库根 `.gitignore` 排除（`/ocr/models/`、`/ocr/venv/`、`/ocr/__pycache__/`、`*.onnx`、`*.tgz`、`*.whl`），**请勿提交第三方二进制**。
- 镜像构建阶段（`python engine.py` → `prepare()` → `make_engine(build=True)`）按固定版本从各自上游拉取模型，并写入 `ocr/models/manifest.json`（记录文件名与 SHA256）。
- **运行时不联网下载**：若模型缺失或被篡改，`engine.py` 会直接失败（fail closed），不会回退到任何模型托管地址；代码还通过禁用 `requests` 的网络调用做二次保护。

## 运行时行为与隐私

- OCR 由 Go 后端在容器内以**短生命周期子进程**调用（`python recognize.py <临时图片路径>`），无 OCR 端口、无外部 API、无 API Key、运行时无模型下载。
- 上传图片由 Go 端写入系统临时目录（随机名、权限 `0600`、扩展名仅按检测到的 MIME 给定，不取用户文件名），子进程退出后整个临时目录被删除；图片字节**不会写入账簿数据目录**，识别文本仅在 HTTP 响应中返回。

## 许可证兼容性

- 上述全部第三方组件均为**宽松许可证**（MIT / Apache-2.0 / BSD），**不含任何 Copyleft**（无 GPL / LGPL / AGPL / MPL）。因此本项目以 **MIT** 发布不会继承任何 Copyleft 义务。
- 主要合规义务：Apache-2.0 需保留 NOTICE 与版权声明；MIT 需保留版权与许可文本。构建镜像时应确保各 Python 包的许可证文本与 NOTICE 文件保留在 `site-packages` 的 `dist-info` 目录中（RapidOCR / PaddleOCR / ONNX Runtime 等均有此要求）。
- 本项目（Gift Book）本身以 MIT 许可证发布，见仓库根 `LICENSE`。

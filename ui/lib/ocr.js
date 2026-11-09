/* Built-in paper ledger import. No CDN, external API or plaintext draft storage. */
(function (root) {
  "use strict";
  const digits = { 零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 贰: 2, 貳: 2, 两: 2, 兩: 2, 三: 3, 叁: 3, 參: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 陸: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9 };
  const units = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const clean = value => String(value ?? "").normalize("NFKC").replace(/\s/g, "");

  function chineseInteger(text) {
    if (!text) return 0;
    if (![...text].every(c => c in digits || c in units || "万萬".includes(c))) return null;
    if (!/[十拾百佰千仟万萬]/.test(text)) {
      // A sequence of digits is not a conventional money amount.
      return text.length === 1 ? digits[text] : null;
    }
    let total = 0, section = 0, number = null, lastUnit = Infinity, lastDigit = false, usedWan = false;
    for (const c of text) {
      if (c in digits) {
        if (lastDigit && number !== 0) return null;
        number = digits[c]; lastDigit = true;
      } else if (c in units) {
        const u = units[c];
        if (u >= lastUnit || (number === null && u !== 10) || number === 0) return null;
        section += (number ?? 1) * u;
        number = null; lastDigit = false; lastUnit = u;
      } else {
        if (usedWan || section + (number ?? 0) === 0) return null;
        total += (section + (number ?? 0)) * 10000;
        section = 0; number = null; lastDigit = false; lastUnit = Infinity; usedWan = true;
      }
    }
    return total + section + (number ?? 0);
  }

  function parseAmount(value) {
    let s = clean(value).replace(/^(?:人民币|RMB|金额[:：]?|礼金[:：]?|奠仪[:：]?)/i, "").replace(/^[¥￥]/, "");
    if (/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?(?:元(?:整|正)?)?$/.test(s)) {
      const n = Number(s.replace(/[,元整正]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    s = s.replace(/圆|圓/g, "元").replace(/正$/, "整");
    if (!s || !/[十拾百佰千仟万萬元角分]/.test(s)) return null;
    // Strict grammar. Do not guess at missing/unclear digits or OCR lookalikes.
    const match = s.match(/^([^元角分整]*)(?:元)?(?:([零〇一壹二贰貳两兩三叁參四肆五伍六陆陸七柒八捌九玖])角)?(?:零)?(?:([零〇一壹二贰貳两兩三叁參四肆五伍六陆陸七柒八捌九玖])分)?(?:整)?$/);
    if (!match || (!match[1] && !match[2] && !match[3])) return null;
    const integer = chineseInteger(match[1]);
    if (integer === null) return null;
    return Math.round((integer + (digits[match[2]] ?? 0) / 10 + (digits[match[3]] ?? 0) / 100) * 100) / 100;
  }

  function rect(line) {
    const xs = line.box.map(p => p[0]), ys = line.box.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys), right = Math.max(...xs), bottom = Math.max(...ys);
    return { x, y, right, bottom, w: right - x, h: bottom - y, cx: (x + right) / 2, cy: (y + bottom) / 2 };
  }
  const header = s => /(?:礼簿|禮簿|贺礼|奠仪登记|礼金登记|合计|总计|小计|经办|登记人|收款人|第.+页)/.test(s)
    || /^(?:姓名|名字|金额|礼金|奠仪|备注|收款方式|现金|微信|支付宝|其他|元|贺|礼|奠|仪)$/.test(s);
  const isName = s => !header(s) && /^[\p{L}\p{M}·•]{2,20}$/u.test(s);

  /**
   * 估计整页的倾斜角（弧度）。
   * 竖排礼簿里同一列的字共线，对每一列做最小二乘拟合，取斜率中位数。
   * 列太短（<3 字）不参与，避免噪声。
   */
  function estimateSkew(lines) {
    const glyphs = lines.filter(l => /^\p{Script=Han}$/u.test(l.text));
    if (glyphs.length < 6) return 0;
    const slopes = [];
    const used = new Set();
    for (const first of glyphs) {
      if (used.has(first)) continue;
      const col = glyphs.filter(l => Math.abs(l.r.cx - first.r.cx) < Math.max(10, first.r.w * .6));
      if (col.length < 3) continue;
      col.sort((a, b) => a.r.cy - b.r.cy);
      // 只接受线性度足够好的列（残差小）
      const n = col.length;
      const mx = col.reduce((s, l) => s + l.r.cx, 0) / n;
      const my = col.reduce((s, l) => s + l.r.cy, 0) / n;
      let num = 0, den = 0;
      for (const l of col) {
        num += (l.r.cx - mx) * (l.r.cy - my);
        den += (l.r.cy - my) ** 2;
      }
      if (den < 1e-6) continue;
      const slope = num / den; // dx/dy
      if (Math.abs(slope) > 0.35) continue; // 太斜不像是拍摄角度
      slopes.push(slope);
      col.forEach(l => used.add(l));
    }
    if (!slopes.length) return 0;
    slopes.sort((a, b) => a - b);
    const median = slopes[Math.floor(slopes.length / 2)];
    // 斜率 dx/dy 为负表示整页顺时针倾斜；换算成需要反转的旋转角
    return -Math.atan(median);
  }

  function extractRows(input, layout = "auto") {
    let lines = input.filter(l => l && typeof l.text === "string" && Array.isArray(l.box) && l.box.length === 4)
      .map(l => ({ ...l, text: clean(l.text), r: rect(l) })).filter(l => l.text);
    if (!lines.length) return [];

    // 分列时用「倾斜补偿后的列坐标」把同一列的字归到一起。
    // 倾斜角估计只作为辅助：估不准时退化为按 x 就近归并，仍能工作。
    const skew = estimateSkew(lines);
    const tanSkew = Math.abs(skew) > 0.004 ? Math.tan(skew) : 0

    // 竖排礼簿：先按「倾斜后的列」聚字，再在列内按纵向间距切行。
    // 直接按 y 分带在倾斜时会把不同列的字交错切开，所以必须先分列。
    const glyphs = lines.filter(l => /^\p{Script=Han}$/u.test(l.text));
    const joined = new Set(), merged = [];
    if (glyphs.length >= 2) {
      const avgH = glyphs.reduce((sum, l) => sum + l.r.h, 0) / glyphs.length
      const avgW = glyphs.reduce((sum, l) => sum + l.r.w, 0) / glyphs.length

      // 用倾斜角把每个字投影到「列的横坐标」上：x 随 y 漂移的部分被扣掉
      const projX = l => l.r.cx - tanSkew * l.r.cy
      const ordered = [...glyphs].sort((a, b) => projX(a) - projX(b))
      // 列间距通常 >= 1.5 个字宽；容差取 0.55 字宽，既容忍倾斜漂移又不会把相邻列并掉
      const colTol = Math.max(avgW * .55, 10)
      const cols = []
      for (const l of ordered) {
        const px = projX(l)
        let best = null, bestD = Infinity
        for (const c of cols) {
          const ref = c[c.length - 1]
          const d = Math.abs(projX(ref) - px)
          if (d < bestD && d <= colTol) { best = c; bestD = d }
        }
        if (best) best.push(l)
        else cols.push([l])
      }

      for (const col of cols) {
        col.sort((a, b) => a.r.cy - b.r.cy)
        // 列内按纵向间距切行：正常字距约 1.0~1.4 字高，跨行会明显更大
        const steps = []
        for (let i = 1; i < col.length; i++) steps.push(Math.abs(col[i].r.cy - col[i - 1].r.cy))
        const sortedSteps = [...steps].sort((a, b) => a - b)
        const medianStep = sortedSteps[Math.floor(sortedSteps.length / 2)] || avgH
        const cut = Math.max(avgH * 1.6, medianStep * 1.35)
        let run = []
        const flush = () => {
          if (!run.length) return
          run.forEach(l => joined.add(l))
          const x = Math.min(...run.map(l => l.r.x)), right = Math.max(...run.map(l => l.r.right))
          const y = Math.min(...run.map(l => l.r.y)), bottom = Math.max(...run.map(l => l.r.bottom))
          const line = { text: run.map(l => l.text).join(""), score: Math.min(...run.map(l => l.score)), box: [[x, y], [right, y], [right, bottom], [x, bottom]] }
          merged.push({ ...line, r: rect(line) })
          run = []
        }
        for (const l of col) {
          if (run.length && Math.abs(l.r.cy - run[run.length - 1].r.cy) > cut) flush()
          run.push(l)
        }
        flush()
      }
    }
    lines = lines.filter(l => !joined.has(l)).concat(merged);
    const rows = [], amounts = [], names = [];
    for (const line of lines) {
      if (header(line.text)) continue;
      const amount = parseAmount(line.text);
      if (amount !== null) { amounts.push({ line, amount }); continue; }
      // Some detectors put a complete horizontal entry in a single line.
      let inline = false;
      for (let i = 2; i <= Math.min(20, line.text.length - 1); i++) {
        const name = line.text.slice(0, i).replace(/[:：]$/, "");
        const n = parseAmount(line.text.slice(i).replace(/^[:：]/, ""));
        if (isName(name) && n !== null) {
          rows.push({ name, amount: String(n), score: line.score, box: line.box, raw: line.text, warning: "同一文本块匹配，请核对姓名与金额分界" });
          inline = true; break;
        }
      }
      if (!inline && isName(line.text)) names.push(line);
    }
    // 竖排配对：一张礼簿的每一行通常独立成条，姓名与金额在同一水平带内。
    // 不能比中心点——「伍佰元」三字比「王强」两字长得多，中心会错开一整行。
    // 改用纵向重叠比例 + 列间距，只要处在同一条横带里就算匹配。
    const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
    const cost = (name, money, mode) => {
      const a = name.r, b = money.line.r;
      if (mode === "horizontal") {
        // 横排礼簿：金额在姓名右侧，同一行
        if (b.cx <= a.cx) return Infinity;
        const ov = overlap(a.y, a.bottom, b.y, b.bottom);
        const ratio = ov / Math.max(1, Math.min(a.h, b.h));
        if (ratio < .35) return Infinity;
        return (1 - ratio) * 6 + Math.abs(a.cy - b.cy) / Math.max(a.h, b.h, 1) + (b.cx - a.cx) / 10000;
      }
      if (mode === "vertical") {
        // 竖排礼簿：金额列在姓名列左侧（从右往左读），必须纵向有重叠
        if (b.cx >= a.cx) return Infinity;
        const ov = overlap(a.y, a.bottom, b.y, b.bottom);
        const ratio = ov / Math.max(1, Math.min(a.h, b.h));
        if (ratio < .35) return Infinity;
        return (1 - ratio) * 6 + Math.abs(a.cx - b.cx) / 10000;
      }
      return Infinity;
    };
    if (layout === "auto") {
      const count = mode => names.filter(n => amounts.some(a => Number.isFinite(cost(n, a, mode)))).length;
      layout = count("vertical") > count("horizontal") ? "vertical" : "horizontal";
    }
    // 匹配阶段：姓名与金额一对一配对。
    // 第一轮用严格的同带判据；第二轮放宽到「任意未被占用的金额」，按距离择优，
    // 避免倾斜/错行时整列金额被丢弃，同时保留提示让用户核对。
    const used = new Set()
    const pairs = [] // { row, sortKey }
    const rowFor = (name, money, warning) => {
      if (!money) {
        return { name: name.text, amount: "", score: name.score, box: name.box, raw: name.text, warning: "未匹配金额，请补全或排除" }
      }
      const box = name.box.concat(money.line.box)
      const xs = box.map(p => p[0]), ys = box.map(p => p[1])
      return {
        name: name.text,
        amount: String(money.amount),
        score: Math.min(name.score, money.line.score),
        box: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)], [Math.min(...xs), Math.max(...ys)]],
        raw: name.text + " / " + money.line.text,
        warning,
      }
    }
    const sortKeyOf = (rec) => {
      const r = rec.line ? rec.line.r : rec.r
      return layout === "vertical" ? [-r.cx, r.cy] : [r.cy, r.cx]
    }

    for (const name of names) {
      const strict = amounts.filter(a => !used.has(a))
        .map(a => ({ a, cost: cost(name, a, layout) }))
        .filter(a => Number.isFinite(a.cost))
        .sort((a, b) => a.cost - b.cost)
      let matched = strict[0]?.a
      let warning = strict[0] && strict[1] && strict[1].cost - strict[0].cost < .12 ? "姓名与金额匹配存在歧义" : ""
      if (!matched) {
        // 兜底：距离最近、尚未占用的金额（再不济也不要丢掉这笔钱）
        const loose = amounts.filter(a => !used.has(a))
          .map(a => ({ a, d: Math.hypot(name.r.cx - a.line.r.cx, name.r.cy - a.line.r.cy) }))
          .sort((x, y) => x.d - y.d)
        if (loose.length && loose[0].d < Math.max(name.r.w, name.r.h) * 12) {
          matched = loose[0].a
          warning = "姓名与金额距离较远，请核对"
        }
      }
      if (matched) used.add(matched)
      pairs.push({ sortKey: sortKeyOf(name), row: rowFor(name, matched, warning) })
    }
    for (const money of amounts.filter(a => !used.has(a))) {
      const r = money.line.r
      pairs.push({
        sortKey: layout === "vertical" ? [-r.cx, r.cy] : [r.cy, r.cx],
        row: { name: "", amount: String(money.amount), score: money.line.score, box: money.line.box, raw: money.line.text, warning: "未匹配姓名，请补全或排除" },
      })
    }

    // 按阅读顺序输出：竖排从右到左、每列自上而下；横排自上而下、自左而右
    pairs.sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1])
    return pairs.map(p => p.row).filter(r => {
      // 丢弃纯噪声：姓名和金额同时为空，或文本里没有任何有效字符
      if (!r.name && !r.amount) return false
      if (r.name && !/[\p{L}\p{N}]/u.test(r.name)) return false
      return true
    })
  }

  function open(options) {
    if (typeof document === "undefined" || document.querySelector("#paper-ocr-dialog")) return;
    const opener = document.activeElement, previousOverflow = document.body.style.overflow;
    const dialog = document.createElement("dialog");
    dialog.id = "paper-ocr-dialog";
    dialog.setAttribute("aria-labelledby", "ocr-heading");
    dialog.className = "paper-ocr";
    dialog.innerHTML = `
      <header class="ocr-head"><div><span class="ocr-kicker">纸上心意 · 数字留存</span><h2 id="ocr-heading">扫描纸质礼簿</h2><p>导入「${esc(options.eventName)}」 · 图片仅在本容器识别</p>${options.notice ? `<p class="ocr-late-notice">${esc(options.notice)}</p>` : ""}</div><button type="button" class="ocr-close" aria-label="关闭扫描窗口">×</button></header>
      <div class="ocr-body">
        <section class="ocr-source" aria-label="原图对照">
          <div class="ocr-section-title"><b>01 上传原图</b><span class="ocr-local">内置离线 OCR</span></div>
          <div class="ocr-upload"><span class="ocr-upload-mark" aria-hidden="true">扫</span><strong>把纸质礼簿，留成电子记录</strong><p>每次最多 10 张，总计不超过 30MB<br>JPG / PNG / WebP · 每张 ≤ 8MB、1600 万像素</p><div class="ocr-upload-actions"><button type="button" id="ocr-camera" class="ocr-primary">拍照扫描</button><button type="button" id="ocr-choose">从相册 / 文件选择</button></div><p class="ocr-camera-hint" id="ocr-camera-hint"></p></div>
          <input id="ocr-files" type="file" accept="image/jpeg,image/png,image/webp" multiple class="ocr-file-input">
          <input id="ocr-camera-file" type="file" accept="image/*" capture="environment" class="ocr-file-input">
          <div class="ocr-recognize-controls"><label>版式 <select id="ocr-layout"><option value="auto">自动匹配</option><option value="horizontal">横排：同一行姓名与金额</option><option value="vertical">竖排：同一列上姓名下金额</option></select></label><button type="button" id="ocr-recognize" disabled>开始识别</button></div>
          <div id="ocr-thumbnails" class="ocr-thumbnails" aria-label="图片列表"></div>
          <figure class="ocr-preview" hidden><div class="ocr-image-wrap"><img id="ocr-preview-image" alt="礼簿原图"><span id="ocr-highlight" hidden></span></div><figcaption id="ocr-image-caption"></figcaption></figure>
          <p class="ocr-note">请拍清晰、平整的单页，避免反光和手指遮挡。手写或模糊内容可能识别错误，必须对照原图核对；未匹配的内容不会自动入账。</p>
          <details class="ocr-raw"><summary>查看识别原文与未配对内容</summary><pre id="ocr-raw-text">尚未识别</pre></details>
        </section>
        <section class="ocr-review" aria-label="识别结果核对">
          <div class="ocr-section-title"><b>02 核对每一笔</b><button type="button" id="ocr-add-row">＋ 手动补一笔</button></div>
          <p class="ocr-note">识别结果只是草稿。点击记录可切换原图定位；收款方式默认“其他”，请按原件修改。</p>
          <div id="ocr-empty" class="ocr-empty"><span aria-hidden="true">簿</span><strong>先上传，再安心核对</strong><p>姓名、金额和备注将在这里整理<br>确认之前，不会写入任何账目</p></div>
          <div id="ocr-rows"></div>
          <div id="ocr-summary" class="ocr-summary">待核对 0 笔 · ¥0.00</div>
        </section>
      </div>
      <footer class="ocr-footer"><div><p id="ocr-status" role="status" aria-live="polite">上传礼簿后开始识别；无需外部识别服务。</p><label class="ocr-reviewed"><input type="checkbox" id="ocr-reviewed">我已对照原图，逐笔核对所选姓名、金额和重复提示</label></div><button type="button" id="ocr-import" disabled>确认导入所选记录</button></footer>`;
    document.body.append(dialog);
    document.body.style.overflow = "hidden";
    const scan = root.GiftBookScan || null;
    let preparing = false, stopCamera = null;
    let files = [], rows = [], busy = "", activeIndex = 0, controller, closed = false, interrupted = false, lastLayout = "auto";
    const $ = selector => dialog.querySelector(selector);
    const status = text => { $("#ocr-status").textContent = text; };
    const money = n => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(n);
    const writableRows = () => rows.filter(r => r.selected && !["saved", "queued"].includes(r.state));
    const invalidate = () => { $("#ocr-reviewed").checked = false; };
    const valid = row => row.name.trim().length >= 1 && row.name.trim().length <= 20 && parseAmount(row.amount) !== null && parseAmount(row.amount) >= .01 && parseAmount(row.amount) <= 1000000;
    function warnings(row) {
      const list = [];
      if (!valid(row)) list.push("请填写有效姓名和金额（0.01～100 万，最多两位小数）");
      if (row.warning) list.push(row.warning);
      if (row.score < .85) list.push("识别置信度较低，请仔细核对");
      if (row.name.trim() && (options.existing.some(x => clean(x.name) === clean(row.name)) || rows.some(x => x !== row && clean(x.name) === clean(row.name)))) list.push("存在同名记录，请确认不是重复导入");
      return [...new Set(list)];
    }
    function sync() {
      const selected = writableRows(), amount = selected.reduce((n, r) => n + (parseAmount(r.amount) ?? 0), 0);
      const saved = rows.filter(r => r.state === "saved").length, queued = rows.filter(r => r.state === "queued").length;
      $("#ocr-summary").textContent = `待导入 ${selected.length} 笔 · ${money(amount)}${saved ? ` · 已导入 ${saved} 笔` : ""}${queued ? ` · 加密待同步 ${queued} 笔` : ""}`;
      $("#ocr-import").disabled = !!busy || !selected.length || !selected.every(valid) || !$("#ocr-reviewed").checked;
      $("#ocr-recognize").disabled = !!busy || preparing || !files.length || saved + queued > 0;
      $("#ocr-recognize").textContent = busy === "recognize" ? "正在本地识别…" : rows.length ? "重新识别（替换草稿）" : "开始识别";
      $("#ocr-import").textContent = busy === "import" ? "正在逐笔导入…" : "确认导入所选记录";
      $("#ocr-add-row").disabled = !!busy;
      $("#ocr-choose").disabled = $("#ocr-camera").disabled = !!busy || preparing || saved + queued > 0;
      dialog.querySelectorAll("[data-adjust]").forEach(button => { button.disabled = !!busy || preparing || saved + queued > 0; });
      $("#ocr-layout").disabled = !!busy || saved + queued > 0;
      dialog.querySelectorAll("[data-remove]").forEach(button => { button.disabled = !!busy || saved + queued > 0; });
      $("#ocr-reviewed").disabled = !!busy;
      dialog.querySelectorAll(".ocr-row").forEach((el, i) => {
        const row = rows[i], locked = !!busy || ["saved", "queued"].includes(row.state);
        el.querySelectorAll("input,select,button").forEach(e => { e.disabled = locked; });
        const info = el.querySelector(".ocr-row-info");
        info.textContent = row.state === "saved" ? "已加密导入" : row.state === "queued" ? "已加密暂存，等待自动同步" : warnings(row).join(" · ") || "请对照原图核对";
        el.classList.toggle("ocr-row-warning", !locked && warnings(row).length > 0);
      });
    }
    function showImage(index, box) {
      activeIndex = index;
      const file = files[index];
      if (!file) return;
      $(".ocr-preview").hidden = false;
      $("#ocr-preview-image").src = file.url;
      $("#ocr-image-caption").textContent = `第 ${index + 1} 页 · ${file.file.name}`;
      const highlight = $("#ocr-highlight");
      highlight.hidden = !box || !file.result;
      if (!highlight.hidden) {
        const r = rect({ box });
        Object.assign(highlight.style, { left: `${r.x / file.result.width * 100}%`, top: `${r.y / file.result.height * 100}%`, width: `${r.w / file.result.width * 100}%`, height: `${r.h / file.result.height * 100}%` });
      }
    }
    function renderFiles() {
      $("#ocr-thumbnails").innerHTML = files.map((f, i) => `<div class="${f.corrected ? "is-corrected" : ""}"><button type="button" data-page="${i}" title="${esc(f.file.name)}"><img src="${f.url}" alt="第 ${i + 1} 页"><span>第 ${i + 1} 页${f.corrected ? " · 已校正" : ""}</span></button><button type="button" data-adjust="${i}" class="ocr-adjust" aria-label="调整第 ${i + 1} 页边框">边框</button><button type="button" data-remove="${i}" aria-label="移除第 ${i + 1} 页">×</button></div>`).join("");
      $("#ocr-thumbnails").querySelectorAll("[data-adjust]").forEach(b => b.onclick = () => adjustPage(Number(b.dataset.adjust)));
      $("#ocr-thumbnails").querySelectorAll("[data-page]").forEach(b => b.onclick = () => showImage(Number(b.dataset.page)));
      $("#ocr-thumbnails").querySelectorAll("[data-remove]").forEach(b => b.onclick = () => {
        if (busy || rows.some(r => r.state === "saved" || r.state === "queued")) return;
        if (rows.length && !confirm("移除图片会清空当前核对草稿，是否继续？")) return;
        const index = Number(b.dataset.remove);
        URL.revokeObjectURL(files[index].url); files.splice(index, 1);
        activeIndex = Math.min(activeIndex, Math.max(0, files.length - 1));
        rows = []; invalidate(); renderRows(); renderFiles();
      });
      if (files.length) showImage(Math.min(activeIndex, files.length - 1));
      else $(".ocr-preview").hidden = true;
      sync();
    }
    function makeRow(candidate, pageIndex) {
      return { ...candidate, pageIndex, requestId: options.newRequestId(), type: "其他", remarks: pageIndex < 0 ? "纸质礼簿导入 · 手动核对" : `纸质礼簿导入 · 第 ${pageIndex + 1} 页`, selected: !!candidate.name && candidate.amount !== "", state: "", score: candidate.score ?? 1 };
    }
    function renderRows() {
      $("#ocr-empty").hidden = rows.length > 0;
      $("#ocr-rows").innerHTML = rows.map((row, i) => `<article class="ocr-row" data-row="${i}">
        <div class="ocr-row-top"><label><input type="checkbox" data-field="selected" ${row.selected ? "checked" : ""}>第 ${i + 1} 笔${row.pageIndex >= 0 ? ` · 第 ${row.pageIndex + 1} 页` : " · 手动补录"}</label><button type="button" data-action="locate">对照原图</button></div>
        <label>姓名<input data-field="name" type="text" maxlength="20" autocomplete="off" value="${esc(row.name)}" aria-label="第 ${i + 1} 笔姓名"></label>
        <label>金额 / 元<input data-field="amount" type="text" inputmode="decimal" autocomplete="off" value="${esc(row.amount)}" aria-label="第 ${i + 1} 笔金额"></label>
        <label>收款方式<select data-field="type" aria-label="第 ${i + 1} 笔收款方式">${["其他", "现金", "支付宝", "微信"].map(t => `<option ${row.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="ocr-remarks">备注<input data-field="remarks" type="text" maxlength="1000" value="${esc(row.remarks)}" aria-label="第 ${i + 1} 笔备注"></label>
        <p class="ocr-row-info"></p></article>`).join("");
      $("#ocr-rows").querySelectorAll("[data-field]").forEach(input => input.addEventListener("input", () => {
        const row = rows[Number(input.closest("[data-row]").dataset.row)];
        row[input.dataset.field] = input.type === "checkbox" ? input.checked : input.value;
        if (input.dataset.field === "name" || input.dataset.field === "amount") row.warning = "";
        invalidate(); sync();
      }));
      $("#ocr-rows").querySelectorAll("[data-action=locate]").forEach(b => b.onclick = () => {
        const row = rows[Number(b.closest("[data-row]").dataset.row)];
        if (row.pageIndex >= 0) {
          showImage(row.pageIndex, row.box);
          $(".ocr-preview").scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        }
      });
      sync();
    }
    async function addFiles(list, prepared = null) {
      if (busy) return false;
      const incoming = [...list];
      if (files.length + incoming.length > 10 || files.reduce((n, f) => n + f.file.size, 0) + incoming.reduce((n, f) => n + f.size, 0) > 30 * 1024 * 1024) {
        status("每次最多 10 张、合计 30MB，请分批上传。"); return false;
      }
      for (const f of incoming) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(f.type) || f.size > 8 * 1024 * 1024 || f.size < 1) {
          status(`「${f.name}」无法添加：仅支持 JPG / PNG / WebP，且每张 ≤ 8MB；HEIC 请先转成 JPG。`); return false;
        }
      }
      if (rows.length && !confirm("添加图片会清空当前核对草稿，是否继续？")) return false;
      incoming.forEach((f, k) => {
        if (files.some(x => x.file.name === f.name && x.file.size === f.size && x.file.lastModified === f.lastModified)) return;
        const meta = (prepared && prepared[k]) || {};
        files.push({ file: f, original: meta.original || f, corrected: !!meta.corrected, url: URL.createObjectURL(f) });
      });
      activeIndex = Math.max(0, files.length - 1);
      rows = []; invalidate(); renderRows(); renderFiles();
      status(`已选择 ${files.length} 张礼簿，请点击“开始识别”。`);
      return true;
    }
    /** Gallery / system-camera photos: find the sheet edges and flatten them first. */
    async function prepareAndAdd(list, interactive) {
      const picked = [...list];
      if (!picked.length || busy || preparing) return;
      if (!scan) { await addFiles(picked); return; }
      preparing = true; sync();
      const out = [], meta = [];
      try {
        for (let i = 0; i < picked.length; i++) {
          const f = picked[i];
          if (closed) return;
          if (!["image/jpeg", "image/png", "image/webp"].includes(f.type) || f.size > 8 * 1024 * 1024) { out.push(f); meta.push({}); continue; }
          status(`正在对齐第 ${i + 1} / ${picked.length} 张的纸张边框…`);
          if (interactive && picked.length === 1) {
            let chosen;
            try { chosen = await scan.adjust(dialog, f, { status }); }
            catch (_) { chosen = f; }
            if (!chosen) { status("已取消这张照片。"); return; }
            out.push(chosen); meta.push({ original: f, corrected: chosen !== f });
          } else {
            try {
              const r = await scan.autoCorrect(f);
              out.push(r.file); meta.push({ original: f, corrected: r.corrected });
            } catch (_) { out.push(f); meta.push({}); }
          }
        }
      } finally { preparing = false; if (!closed) sync(); }
      if (closed) return;
      if (await addFiles(out, meta)) {
        const fixed = meta.filter(m => m.corrected).length;
        status(`已加入 ${out.length} 张${fixed ? `，其中 ${fixed} 张已对齐边框并拉正` : ""}。可点缩略图上的“边框”微调，然后开始识别。`);
      }
    }
    async function adjustPage(index) {
      const entry = files[index];
      if (!entry || !scan || busy || preparing || rows.some(r => r.state)) return;
      if (rows.length && !confirm("调整边框会清空当前核对草稿，是否继续？")) return;
      preparing = true; sync();
      let chosen = null;
      try { chosen = await scan.adjust(dialog, entry.original || entry.file, { status }); }
      catch (error) { status(error.message || "图片无法读取。"); }
      finally { preparing = false; }
      if (closed) return;
      if (chosen && files[index] === entry) {
        const original = entry.original || entry.file;
        if (chosen.size > 8 * 1024 * 1024) { status("校正后的图片超过 8MB，请缩小原图后重试。"); sync(); return; }
        URL.revokeObjectURL(entry.url);
        files[index] = { file: chosen, original, corrected: chosen !== original, url: URL.createObjectURL(chosen) };
        rows = []; invalidate(); renderRows();
        status(`第 ${index + 1} 页边框已更新，请重新识别。`);
      }
      activeIndex = index; renderFiles();
      dialog.querySelector(`[data-adjust="${index}"]`)?.focus({ preventScroll: true });
    }
    async function openCamera() {
      if (busy || preparing) return;
      if (!scan || !scan.liveCameraSupported()) { $("#ocr-camera-file").click(); return; }
      preparing = true; sync();
      const before = files.length;
      try {
        await scan.camera(dialog, {
          onCapture: file => addFiles([file], [{ original: file, corrected: true }]),
          onOpen: stop => { stopCamera = stop; },
        });
      } catch (error) {
        // Permission denied / no camera / insecure origin: use the system camera instead.
        stopCamera = null; preparing = false; sync();
        status(error && error.name === "NotAllowedError" ? "未获得相机权限，已改用系统相机拍照。" : "无法打开实时取景，已改用系统相机拍照。");
        $("#ocr-camera-file").click();
        return;
      }
      stopCamera = null; preparing = false;
      if (closed) return;
      sync();
      $("#ocr-camera").focus({ preventScroll: true });
      if (files.length > before && !rows.length) recognize();
    }
    async function recognize() {
      if (busy || !files.length) return;
      if (rows.length && !confirm("重新识别将替换尚未导入的修改，是否继续？")) return;
      rows = []; invalidate(); busy = "recognize"; interrupted = false; renderRows(); sync();
      let raw = "";
      for (let i = 0; i < files.length; i++) {
        if (closed) return;
        const file = files[i];
        status(`正在本地识别第 ${i + 1} / ${files.length} 页，首次载入模型可能稍慢…`);
        controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 100000);
        try {
          const form = new FormData(); form.append("image", file.file);
          const response = await fetch("/api/ocr", { method: "POST", credentials: "same-origin", headers: { "X-GiftBook-OCR": "1" }, body: form, signal: controller.signal, cache: "no-store" });
          const result = await response.json();
          if (!response.ok || !result.success) throw Error(result.message || "识别请求失败");
          file.result = result.data;
          raw += `第 ${i + 1} 页 · ${result.data.elapsed}s\n${result.data.lines.map(l => l.text).join("\n") || "未识别到文字"}\n\n`;
          const candidates = extractRows(result.data.lines, $("#ocr-layout").value);
          if (rows.length + candidates.length > 300) throw Error("单批草稿超过 300 笔，此页未加入，请裁剪、分批识别。");
          rows.push(...candidates.map(row => makeRow(row, i)));
        } catch (error) {
          if (closed) return;
          interrupted = true;
          raw += `第 ${i + 1} 页识别失败：${error.name === "AbortError" ? "请求超时" : error.message}\n\n`;
        } finally { clearTimeout(timer); }
      }
      if (closed) return;
      $("#ocr-raw-text").textContent = raw;
      busy = ""; renderRows(); if (files.length) showImage(0);
      if (matchMedia("(min-width: 641px)").matches && files.length) {
        const source = $(".ocr-source"), preview = $("#ocr-thumbnails");
        source.scrollTop += preview.getBoundingClientRect().top - source.getBoundingClientRect().top;
        $(".ocr-review").scrollTop = 0;
      }
      $("#ocr-rows input[data-field=name]")?.focus({ preventScroll: true });
      status(`${interrupted ? "部分页面识别失败，请查看原文并重试或手动补录。" : "本地识别完成。"}整理出 ${rows.length} 笔草稿，请逐笔核对；没有入账。`);
    }
    async function importSelected() {
      const selected = writableRows();
      if (busy || !$("#ocr-reviewed").checked || !selected.length || !selected.every(valid)) return;
      busy = "import"; sync();
      let saved = 0, queued = 0, failure = "";
      try {
        for (const row of selected) {
          status(`正在加密导入 ${saved + queued + 1} / ${selected.length} 笔，请勿关闭页面…`);
          const result = await options.importRow({ ...row, amount: parseAmount(row.amount) });
          row.state = result.queued ? "queued" : "saved";
          if (result.queued) { queued++; failure = "连接中断：这一笔已加密暂存，会由系统自动补传，其余未提交记录仍在草稿中。"; break; }
          saved++; sync();
        }
      } catch (error) { failure = error.message || "导入失败，请重试。"; }
      finally {
        try { await options.refresh(); } catch (_) { /* Persisted/queued rows remain frozen even if refreshing fails. */ }
        busy = ""; invalidate(); renderRows();
        status(`本次已导入 ${saved} 笔${queued ? `，加密待同步 ${queued} 笔` : ""}。${failure || "已导入记录不会再次提交，其余草稿可继续核对。"}`);
      }
    }
    function requestClose() {
      if (busy === "import") { status("正在导入，请等待当前批次结束。"); return; }
      if ((busy || writableRows().length) && !confirm("关闭后未导入的识别草稿将被丢弃；已导入或加密待同步的记录会保留。确定关闭？")) return;
      dialog.close();
    }
    const beforeUnload = event => {
      if (busy || writableRows().length) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    $(".ocr-close").onclick = requestClose;
    dialog.addEventListener("keydown", event => {
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll("button,input,select,textarea,a[href],[tabindex]")]
        .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
    dialog.addEventListener("cancel", e => { e.preventDefault(); requestClose(); });
    dialog.addEventListener("close", () => {
      closed = true; controller?.abort(); stopCamera?.(); files.forEach(f => URL.revokeObjectURL(f.url));
      window.removeEventListener("beforeunload", beforeUnload);
      dialog.remove(); document.body.style.overflow = previousOverflow; opener?.focus?.({ preventScroll: true });
    }, { once: true });
    $("#ocr-choose").addEventListener("click", (e) => {
      e.preventDefault();
      const input = $("#ocr-files");
      // 移动端对 display:none 的 input 会忽略 click()，优先用 showPicker，失败再回退
      try {
        if (typeof input.showPicker === "function") input.showPicker();
        else input.click();
      } catch (_) { input.click(); }
    });
    $("#ocr-camera").onclick = openCamera;
    $("#ocr-files").onchange = () => { const list = [...$("#ocr-files").files]; $("#ocr-files").value = ""; prepareAndAdd(list, false); };
    $("#ocr-camera-file").onchange = () => { const list = [...$("#ocr-camera-file").files]; $("#ocr-camera-file").value = ""; prepareAndAdd(list, true); };
    $("#ocr-camera-hint").textContent = scan && scan.liveCameraSupported()
      ? "拍照扫描会打开实时取景：对准礼簿自动找边，拿稳即自动拍摄并拉正。"
      : "当前为局域网 http 访问，浏览器不允许网页直接取景：将调起系统相机，拍完自动找边拉正，可手动微调。";
    $("#ocr-recognize").onclick = recognize;
    $("#ocr-reviewed").onchange = sync;
    $("#ocr-import").onclick = importSelected;
    $("#ocr-add-row").onclick = () => { rows.push(makeRow({ name: "", amount: "", score: 1, warning: "手动补录，请核对原图" }, -1)); rows[rows.length - 1].selected = true; invalidate(); renderRows(); $("#ocr-rows .ocr-row:last-child input[data-field=name]").focus(); };
    $("#ocr-layout").onchange = () => {
      if (!files.some(f => f.result)) { lastLayout = $("#ocr-layout").value; return; }
      if (rows.some(r => r.state)) return;
      if (rows.length && !confirm("切换版式会重新匹配并替换核对草稿，是否继续？")) { $("#ocr-layout").value = lastLayout; return; }
      const candidates = files.flatMap((f, i) => f.result ? extractRows(f.result.lines, $("#ocr-layout").value).map(r => makeRow(r, i)) : []);
      if (candidates.length > 300) { $("#ocr-layout").value = lastLayout; status("此版式超过 300 笔，请移除部分图片后分批识别。"); return; }
      lastLayout = $("#ocr-layout").value;
      rows = candidates;
      invalidate(); renderRows(); status("已按新选版式重新匹配，请对照原图核对。");
    };
    dialog.showModal();
    sync();
  }

  const api = { open, parseAmount, extractRows };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GiftBookOCR = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

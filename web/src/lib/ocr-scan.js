/*
 * Paper page capture for the built-in OCR importer.
 * - detectQuad(): finds the paper sheet's four corners (pure JS, no network/CDN).
 * - warp(): perspective-corrects the sheet into a flat, upright rectangle.
 * - camera(): live in-page camera with edge overlay and steady auto-capture
 *   (needs HTTPS or localhost; browsers block getUserMedia on plain http).
 * - adjust(): corner editor used after a system-camera photo or uploaded image.
 * Images stay in memory/object URLs only; nothing is stored or uploaded here.
 *
 * 版权与来源：本文件为本项目自行编写（MIT，见仓库 LICENSE），不含第三方代码，
 * 也不依赖 OpenCV 等库。所用方法均为公开发表的通用算法（算法本身不受著作权保护）：
 * Otsu 阈值分割、盒式模糊、连通域标记、形态学闭运算、四点透视变换（单应矩阵 +
 * 高斯消元 + 双线性插值）。
 */
(function (root) {
  "use strict";

  const DETECT_SIDE = 360;

  /* ---------- geometry ---------- */
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function polygonArea(q) {
    let s = 0;
    for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(s) / 2;
  }
  function isConvex(q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(z) < 1e-9) return false;
      if (sign && Math.sign(z) !== sign) return false;
      sign = Math.sign(z);
    }
    return true;
  }
  function cornerAngles(q) {
    return q.map((p, i) => {
      const a = q[(i + 3) % 4], c = q[(i + 1) % 4];
      const v1 = [a[0] - p[0], a[1] - p[1]], v2 = [c[0] - p[0], c[1] - p[1]];
      const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
      return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    });
  }
  /** Order any four points as top-left, top-right, bottom-right, bottom-left. */
  function orderQuad(points) {
    const cx = points.reduce((n, p) => n + p[0], 0) / 4, cy = points.reduce((n, p) => n + p[1], 0) / 4;
    const sorted = points.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    // atan2 order starts near left (-PI); rotate so the point with smallest x+y is first.
    let start = 0;
    sorted.forEach((p, i) => { if (p[0] + p[1] < sorted[start][0] + sorted[start][1]) start = i; });
    return sorted.slice(start).concat(sorted.slice(0, start));
  }
  function validQuad(q, w, h, minArea = 0.12) {
    if (!q || q.length !== 4 || q.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return false;
    if (!isConvex(q)) return false;
    if (polygonArea(q) < w * h * minArea) return false;
    return cornerAngles(q).every(a => a > 40 && a < 140);
  }

  /* ---------- detection ---------- */
  function otsu(values, mask) {
    const hist = new Uint32Array(256);
    let total = 0;
    for (let i = 0; i < values.length; i++) if (!mask || mask[i]) { hist[values[i]]++; total++; }
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; threshold = t; }
    }
    return threshold;
  }
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (2 * r + 1);
        acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }
  /** Largest 4-connected component of mask; returns its pixel indices' extreme corners. */
  function largestComponent(mask, w, h) {
    const label = new Int32Array(w * h), stack = new Int32Array(w * h);
    let best = null, next = 0;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || label[start]) continue;
      next++;
      let sp = 0, count = 0, touches = 0;
      let tl = start, tr = start, br = start, bl = start;
      let tlv = Infinity, trv = -Infinity, brv = -Infinity, blv = Infinity;
      stack[sp++] = start; label[start] = next;
      while (sp) {
        const i = stack[--sp], x = i % w, y = (i - x) / w;
        count++;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches++;
        const s = x + y, d = x - y;
        if (s < tlv) { tlv = s; tl = i; }
        if (s > brv) { brv = s; br = i; }
        if (d > trv) { trv = d; tr = i; }
        if (d < blv) { blv = d; bl = i; }
        if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[sp++] = i - 1; }
        if (x < w - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[sp++] = i + 1; }
        if (y > 0 && mask[i - w] && !label[i - w]) { label[i - w] = next; stack[sp++] = i - w; }
        if (y < h - 1 && mask[i + w] && !label[i + w]) { label[i + w] = next; stack[sp++] = i + w; }
      }
      if (!best || count > best.count) {
        const pt = i => [i % w, Math.floor(i / w)];
        best = { count, touches, id: next, quad: [pt(tl), pt(tr), pt(br), pt(bl)] };
      }
    }
    if (best) best.label = label;
    return best;
  }
  /** Fraction of the quad's interior that is covered by the component (holes from text allowed). */
  function quadFill(comp, w, h) {
    const q = comp.quad;
    const minY = Math.max(0, Math.floor(Math.min(...q.map(p => p[1])))), maxY = Math.min(h - 1, Math.ceil(Math.max(...q.map(p => p[1]))));
    let inside = 0, hit = 0;
    for (let y = minY; y <= maxY; y += 2) {
      const xs = [];
      for (let i = 0; i < 4; i++) {
        const a = q[i], b = q[(i + 1) % 4];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let x = Math.max(0, Math.ceil(xs[0])); x <= Math.min(w - 1, Math.floor(xs[xs.length - 1])); x += 2) {
        inside++;
        if (comp.label[y * w + x] === comp.id) hit++;
      }
    }
    return inside ? hit / inside : 0;
  }
  /** Fill small holes and gaps (text strokes, ruled lines) before labelling. */
  function close(mask, w, h, r) {
    const grow = (src, value) => {
      const out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = !value;
        for (let dy = -r; dy <= r && v !== value; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            if (!!src[yy * w + xx] === value) { v = value; break; }
          }
        }
        out[y * w + x] = v ? 1 : 0;
      }
      return out;
    };
    return grow(grow(mask, true), false);
  }

  /**
   * Find the paper sheet. `source` is a canvas, image or video. Returns
   * { quad: [[x,y]x4] in source pixels (TL,TR,BR,BL), confidence 0..1 } or null.
   */
  function detectQuad(source) {
    const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) return null;
    const scale = Math.min(1, DETECT_SIDE / Math.max(sw, sh));
    const w = Math.max(16, Math.round(sw * scale)), h = Math.max(16, Math.round(sh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    const found = detectPixels(ctx.getImageData(0, 0, w, h).data, w, h);
    if (!found) return null;
    return { quad: found.quad.map(p => [p[0] / scale, p[1] / scale]), confidence: found.confidence };
  }

  /** Core detector on raw RGBA pixels (also used by tests without a DOM). */
  function detectPixels(data, w, h) {
    const gray = new Uint8ClampedArray(w * h), sat = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const r = data[i], g = data[i + 1], b = data[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      gray[j] = (r * 299 + g * 587 + b * 114) / 1000;
      sat[j] = mx ? (mx - mn) * 255 / mx : 0;
    }
    const bg = boxBlur(gray, w, h, 3), bs = boxBlur(sat, w, h, 3);
    const tg = otsu(bg), ts = otsu(bs);
    const candidates = [
      bg.map(v => v > tg ? 1 : 0),          // light paper on darker table
      bs.map(v => v > ts ? 1 : 0),          // red/coloured ledger on neutral table
      bg.map(v => v <= tg ? 1 : 0),         // dark cover on light surface
    ];
    let best = null;
    for (const raw of candidates) {
      const mask = close(Uint8Array.from(raw), w, h, 2);
      const comp = largestComponent(mask, w, h);
      if (!comp) continue;
      const areaRatio = comp.count / (w * h);
      if (areaRatio < 0.12 || areaRatio > 0.985) continue;
      // A background-coloured mask hugs most of the frame border.
      if (comp.touches > (w + h) * 1.2) continue;
      const quad = orderQuad(comp.quad);
      if (!validQuad(quad, w, h)) continue;
      const fill = quadFill({ ...comp, quad }, w, h);
      if (fill < 0.82) continue;
      const score = fill * Math.min(1, polygonArea(quad) / (w * h * 0.35));
      if (!best || score > best.score) best = { quad, score, fill };
    }
    if (!best) return null;
    // Expand by about one detection pixel so the paper edge is not trimmed.
    const c = [best.quad.reduce((n, p) => n + p[0], 0) / 4, best.quad.reduce((n, p) => n + p[1], 0) / 4];
    const quad = best.quad.map(p => {
      const dx = p[0] - c[0], dy = p[1] - c[1], len = Math.hypot(dx, dy) || 1;
      return [Math.min(w, Math.max(0, p[0] + dx / len * 1.2)), Math.min(h, Math.max(0, p[1] + dy / len * 1.2))];
    });
    return { quad, confidence: Math.max(0, Math.min(1, (best.fill - 0.82) / 0.15)) };
  }

  /* ---------- perspective warp ---------- */
  function solve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      if (Math.abs(A[i][i]) < 1e-12) return null;
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
      x[i] = s / A[i][i];
    }
    return x;
  }
  /** Homography mapping dst rectangle points -> src quad points. */
  function homography(dst, src) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = dst[i], [u, v] = src[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b);
    return h && h.concat(1);
  }
  /**
   * Returns a canvas with the quad region flattened into an upright rectangle.
   * Output long side is capped (server downsizes to 2000px anyway).
   */
  function warp(source, quad, maxSide = 2200) {
    const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = sw; srcCanvas.height = sh;
    const sctx = srcCanvas.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(source, 0, 0, sw, sh);
    const src = sctx.getImageData(0, 0, sw, sh).data;
    let ow = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
    let oh = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
    const k = Math.min(1, maxSide / Math.max(ow, oh));
    ow = Math.max(32, Math.round(ow * k)); oh = Math.max(32, Math.round(oh * k));
    const H = homography([[0, 0], [ow - 1, 0], [ow - 1, oh - 1], [0, oh - 1]], quad);
    if (!H) return null;
    const out = document.createElement("canvas");
    out.width = ow; out.height = oh;
    const octx = out.getContext("2d");
    const img = octx.createImageData(ow, oh), d = img.data;
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const z = H[6] * x + H[7] * y + H[8];
        let u = (H[0] * x + H[1] * y + H[2]) / z, v = (H[3] * x + H[4] * y + H[5]) / z;
        u = Math.min(sw - 1.001, Math.max(0, u)); v = Math.min(sh - 1.001, Math.max(0, v));
        const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        const o = (y * ow + x) * 4;
        for (let c = 0; c < 3; c++) {
          d[o + c] = (src[i00 + c] * (1 - fx) + src[i10 + c] * fx) * (1 - fy) + (src[i01 + c] * (1 - fx) + src[i11 + c] * fx) * fy;
        }
        d[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  const toFile = (canvas, name) => new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob) { reject(Error("图片生成失败")); return; }
    resolve(new File([blob], name, { type: "image/jpeg", lastModified: Date.now() }));
  }, "image/jpeg", 0.9));

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.decoding = "async";
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(Error("图片无法读取")); };
      img.src = url;
    });
  }

  /** Downscale a decoded image to a canvas (EXIF orientation already applied by the browser). */
  function imageCanvas(img, maxSide = 3000) {
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  /** Detect and flatten the sheet in an uploaded photo; keeps the original when unsure. */
  async function autoCorrect(file) {
    const { img, url } = await loadImage(file);
    try {
      const base = imageCanvas(img);
      const found = detectQuad(base);
      // Already-flat scans fill nearly the whole frame: leave them untouched.
      if (!found || found.confidence < 0.25 || polygonArea(found.quad) > base.width * base.height * 0.93) return { file, corrected: false };
      const out = warp(base, found.quad);
      if (!out) return { file, corrected: false };
      return { file: await toFile(out, (file.name || "礼簿").replace(/\.\w+$/, "") + "-校正.jpg"), corrected: true };
    } finally { URL.revokeObjectURL(url); }
  }

  const liveCameraSupported =() => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && root.isSecureContext !== false;
  const reducedMotion = () => root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function quadPath(q) { return q.map(p => p.map(n => n.toFixed(1)).join(",")).join(" "); }

  /* ---------- corner editor ---------- */
  /**
   * Shows a full-dialog editor over `host`. Resolves with a File
   * (corrected or original), or null when cancelled.
   */
  async function adjust(host, file, opts = {}) {
    const { img, url } = await loadImage(file);
    const base = imageCanvas(img);
    URL.revokeObjectURL(url);
    const W = base.width, H = base.height;
    const found = detectQuad(base);
    let quad = found ? found.quad.map(p => p.slice()) : [[W * .06, H * .06], [W * .94, H * .06], [W * .94, H * .94], [W * .06, H * .94]];
    const layer = document.createElement("div");
    layer.className = "ocr-layer ocr-crop";
    layer.setAttribute("role", "group");
    layer.setAttribute("aria-label", "调整礼簿边框");
    const shown = base.toDataURL("image/jpeg", 0.85);
    layer.innerHTML = `
      <div class="ocr-layer-head"><div><b>对齐纸张边框</b><span>${found ? "已自动找到纸张四角，可拖动圆点微调" : "未能自动找到边框，请拖动四个圆点对准纸张四角"}</span></div><button type="button" class="ocr-layer-close" data-act="cancel" aria-label="取消">×</button></div>
      <div class="ocr-crop-stage"><div class="ocr-crop-frame"><img alt="待校正的礼簿照片" src="${shown}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polygon class="ocr-quad" points="${quadPath(quad)}"></polygon></svg>${quad.map((_, i) => `<button type="button" class="ocr-handle" data-corner="${i}" aria-label="${["左上", "右上", "右下", "左下"][i]}角，可用方向键微调"></button>`).join("")}</div></div>
      <div class="ocr-layer-actions"><button type="button" data-act="auto">重新识别边框</button><button type="button" data-act="original">使用原图</button><button type="button" class="ocr-primary" data-act="ok">校正并使用</button></div>`;
    host.append(layer);
    const frame = layer.querySelector(".ocr-crop-frame"), poly = layer.querySelector(".ocr-quad");
    const handles = [...layer.querySelectorAll(".ocr-handle")];
    const imgEl = layer.querySelector("img");
    await new Promise(r => imgEl.complete ? r() : (imgEl.onload = r));
    const stage = layer.querySelector(".ocr-crop-stage");
    // Fit the photo inside the stage while keeping its exact aspect ratio,
    // so handle percentages map 1:1 to image pixels.
    const fit = () => {
      const box = stage.getBoundingClientRect();
      const k = Math.min((box.width - 24) / W, (box.height - 24) / H);
      frame.style.width = `${Math.max(40, W * k)}px`;
      frame.style.height = `${Math.max(40, H * k)}px`;
    };
    fit();
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    resize?.observe(stage);
    const place = () => {
      poly.setAttribute("points", quadPath(quad));
      handles.forEach((h, i) => { h.style.left = `${quad[i][0] / W * 100}%`; h.style.top = `${quad[i][1] / H * 100}%`; });
      layer.querySelector('[data-act="ok"]').disabled = !validQuad(quad, W, H, 0.04);
    };
    place();
    handles.forEach((h, i) => {
      h.addEventListener("pointerdown", e => {
        e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add("is-drag");
        const move = ev => {
          const r = frame.getBoundingClientRect();
          quad[i] = [Math.min(W, Math.max(0, (ev.clientX - r.left) / r.width * W)), Math.min(H, Math.max(0, (ev.clientY - r.top) / r.height * H))];
          place();
        };
        const up = () => { h.classList.remove("is-drag"); h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up); };
        h.addEventListener("pointermove", move); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
      });
      h.addEventListener("keydown", e => {
        const step = (e.shiftKey ? 20 : 4) * W / frame.getBoundingClientRect().width;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!d) return;
        e.preventDefault();
        quad[i] = [Math.min(W, Math.max(0, quad[i][0] + d[0])), Math.min(H, Math.max(0, quad[i][1] + d[1]))];
        place();
      });
    });
    handles[0].focus({ preventScroll: true });
    return new Promise(resolve => {
      const finish = value => { resize?.disconnect(); layer.remove(); resolve(value); };
      layer.addEventListener("click", async e => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (!act) return;
        if (act === "cancel") finish(null);
        else if (act === "original") finish(file);
        else if (act === "auto") {
          const again = detectQuad(base);
          if (again) { quad = again.quad.map(p => p.slice()); place(); opts.status?.("已重新找到纸张边框。"); }
          else opts.status?.("仍未找到清晰边框：请把礼簿放在深色桌面上重拍，或手动拖动四角。");
        } else if (act === "ok") {
          layer.classList.add("is-busy");
          await new Promise(r => setTimeout(r, 30));
          const out = warp(base, quad);
          if (!out) { layer.classList.remove("is-busy"); opts.status?.("四个角的位置无法校正，请重新调整。"); return; }
          try { finish(await toFile(out, (file.name || "礼簿").replace(/\.\w+$/, "") + "-校正.jpg")); }
          catch (err) { layer.classList.remove("is-busy"); opts.status?.(err.message); }
        }
      });
      layer.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); } });
    });
  }

  /* ---------- live camera ---------- */
  /**
   * Opens a live camera layer inside `host`. Each captured page is passed to
   * opts.onCapture(File). Resolves when the user closes the camera.
   */
  async function camera(host, opts = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } },
    });
    const layer = document.createElement("div");
    layer.className = "ocr-layer ocr-cam";
    layer.setAttribute("role", "group");
    layer.setAttribute("aria-label", "拍摄纸质礼簿");
    layer.innerHTML = `
      <div class="ocr-cam-view"><video playsinline muted autoplay></video><svg aria-hidden="true" preserveAspectRatio="xMidYMid meet"><polygon class="ocr-quad"></polygon></svg><div class="ocr-cam-guide" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="ocr-cam-flash" aria-hidden="true"></div></div>
      <div class="ocr-cam-top"><button type="button" class="ocr-layer-close" data-act="close" aria-label="关闭相机">×</button><p class="ocr-cam-tip" role="status" aria-live="polite">把整页礼簿放进取景框，四边留出一点桌面</p><button type="button" class="ocr-cam-torch" data-act="torch" hidden aria-pressed="false">补光</button></div>
      <div class="ocr-cam-bar">
        <label class="ocr-cam-auto"><input type="checkbox" checked> 对齐后自动拍</label>
        <button type="button" class="ocr-shutter" data-act="shoot" aria-label="拍摄这一页"><span></span></button>
        <button type="button" class="ocr-cam-done" data-act="close">完成 <b>0</b> 页</button>
      </div>`;
    host.append(layer);
    const video = layer.querySelector("video"), svg = layer.querySelector("svg"), poly = layer.querySelector(".ocr-quad");
    const tip = layer.querySelector(".ocr-cam-tip"), auto = layer.querySelector(".ocr-cam-auto input");
    const doneCount = layer.querySelector(".ocr-cam-done b");
    video.srcObject = stream;
    try { await video.play(); } catch (_) { /* autoplay may need the user's tap; frames still arrive */ }
    await new Promise(r => video.readyState >= 2 ? r() : video.addEventListener("loadeddata", r, { once: true }));
    const track = stream.getVideoTracks()[0];
    const torchButton = layer.querySelector(".ocr-cam-torch");
    try { if (track.getCapabilities?.().torch) torchButton.hidden = false; } catch (_) { /* optional */ }
    let closed = false, busy = false, timer = 0, history = [], steadySince = 0, armed = true, lastQuad = null, count = 0;
    // 取景框平滑：每帧检测都有 1~3px 的随机误差，直接绘制会让四角来回抖。
    // 用一阶低通滤波，并在相邻两帧差异过大时先回落一半，避免「跳一下」。
    let smoothQuad = null, missCount = 0;
    function stabilize(quad, diag) {
      if (!smoothQuad) {
        smoothQuad = quad.map(p => [...p]);
        return smoothQuad;
      }
      const jump = Math.max(...quad.map((p, i) => dist(p, smoothQuad[i]))) / diag;
      // 明显移动（换页/挪手机）直接跟随，不做平滑，否则会跟不上
      const alpha = jump > 0.06 ? 0.9 : 0.28;
      smoothQuad = quad.map((p, i) => [
        smoothQuad[i][0] + (p[0] - smoothQuad[i][0]) * alpha,
        smoothQuad[i][1] + (p[1] - smoothQuad[i][1]) * alpha,
      ]);
      return smoothQuad.map(p => [...p]);
    }
    const setTip = text => { if (tip.textContent !== text) tip.textContent = text; };
    const vw = () => video.videoWidth, vh = () => video.videoHeight;
    function drawQuad(q, state) {
      svg.setAttribute("viewBox", `0 0 ${vw()} ${vh()}`);
      poly.setAttribute("points", q ? quadPath(q) : "");
      layer.dataset.state = state;
    }
    async function shoot(quad) {
      if (busy || closed) return;
      busy = true;
      layer.classList.add("is-shot");
      setTimeout(() => layer.classList.remove("is-shot"), reducedMotion() ? 0 : 260);
      try {
        const frame = document.createElement("canvas");
        frame.width = vw(); frame.height = vh();
        frame.getContext("2d").drawImage(video, 0, 0);
        const found = quad ? { quad } : detectQuad(frame);
        const out = found ? warp(frame, found.quad) : frame;
        const file = await toFile(out, `拍摄第${count + 1}页.jpg`);
        const accepted = await opts.onCapture?.(file, !!found);
        if (accepted !== false) {
          count++; doneCount.textContent = count;
          setTip(found ? `第 ${count} 页已拍好并校正。翻到下一页继续，或点“完成”。` : `第 ${count} 页已拍下（未找到边框，保留整张画面）。`);
        } else {
          setTip("这一页没有加入：每批最多 10 张、合计 30MB。请点“完成”先识别这一批。");
        }
        lastQuad = found?.quad || null; armed = false; history = []; steadySince = 0;
        // 拍完重置平滑状态，翻页后立刻贴合新位置，不从上一页的框缓过来
        smoothQuad = null; missCount = 0;
      } catch (err) {
        setTip(err.message || "拍摄失败，请重试。");
      } finally { busy = false; }
    }
    function tick() {
      if (closed) return;
      if (!busy && vw()) {
        const raw = detectQuad(video);
        const diag = Math.hypot(vw(), vh());
        if (!raw) {
          // 偶发丢帧不要让框闪一下就消失：连续丢失若干次才真正清空
          missCount += 1;
          if (missCount >= 3) {
            history = []; steadySince = 0; smoothQuad = null;
            if (!armed && lastQuad) armed = true; // page removed or turned
            drawQuad(null, "search");
            setTip(armed ? "把整页礼簿放进取景框，四边留出一点桌面" : "已拍好。翻页或换下一张后会继续自动拍");
          }
        } else {
          missCount = 0;
          const found = { ...raw, quad: stabilize(raw.quad, diag) };
          const q = found.quad;
          const moved = history.length ? Math.max(...q.map((p, i) => dist(p, history[history.length - 1][i]))) / diag : 1;
          history.push(q); if (history.length > 6) history.shift();
          if (!armed && lastQuad && Math.max(...q.map((p, i) => dist(p, lastQuad[i]))) / diag > 0.12) armed = true;
          if (moved > 0.025) steadySince = performance.now();
          const steadyMs = performance.now() - steadySince;
          const ready = auto.checked && armed && history.length >= 3 && steadyMs > 900;
          drawQuad(q, ready ? "ready" : "found");
          if (!armed) setTip("这一页已拍好。翻页或换下一张后继续，或按快门再拍一次");
          else if (!auto.checked) setTip("已找到纸张边框，按快门拍摄");
          else setTip(steadyMs > 300 ? "对齐了，请保持不动…" : "已找到边框，请拿稳手机");
          if (ready) { shoot(raw.quad); }
        }
      }
      timer = setTimeout(tick, 220);
    }
    tick();
    return new Promise(resolve => {
      const finish = () => {
        if (closed) return;
        closed = true; clearTimeout(timer);
        stream.getTracks().forEach(t => t.stop());
        layer.remove();
        resolve(count);
      };
      layer.addEventListener("click", async e => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "close") finish();
        else if (act === "shoot") shoot(history.length ? history[history.length - 1] : null);
        else if (act === "torch") {
          const on = torchButton.getAttribute("aria-pressed") !== "true";
          try { await track.applyConstraints({ advanced: [{ torch: on }] }); torchButton.setAttribute("aria-pressed", String(on)); } catch (_) { torchButton.hidden = true; }
        }
      });
      layer.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(); } });
      opts.onOpen?.(finish);
      layer.querySelector(".ocr-shutter").focus({ preventScroll: true });
    });
  }

  const api = { detectQuad, detectPixels, warp, adjust, camera, autoCorrect, liveCameraSupported, orderQuad, validQuad, homography };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GiftBookScan = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

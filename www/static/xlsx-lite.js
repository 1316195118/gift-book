/*!
 * xlsx-lite.js —— 自研最小 XLSX 写出器（无第三方库）
 *
 * 支持：多工作表、列宽、合并单元格、冻结窗格、筛选、行高、
 * 单元格样式（字体/填充/边框/对齐/金额格式）。
 * 采用 ZIP 的「存储」模式（不压缩）+ inlineStr，WPS / Excel / Numbers 均可打开。
 */
(function (global) {
  "use strict";

  const enc = (text) => new TextEncoder().encode(text);

  /* ---------- CRC32 ---------- */
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* ---------- ZIP（store） ---------- */
  function dosTime(date) {
    const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
    const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
    return { time, day };
  }

  function buildZip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const { time, day } = dosTime(new Date());

    files.forEach((file) => {
      const nameBytes = enc(file.name);
      const data = file.data instanceof Uint8Array ? file.data : enc(file.data);
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, time, true);
      lv.setUint16(12, day, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      chunks.push(local, data);

      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, day, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + data.length;
    });

    const centralSize = central.reduce((sum, c) => sum + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const total = offset + centralSize + end.length;
    const out = new Uint8Array(total);
    let p = 0;
    chunks.concat(central).forEach((chunk) => {
      out.set(chunk, p);
      p += chunk.length;
    });
    out.set(end, p);
    return out;
  }

  /* ---------- XML 工具 ---------- */
  const esc = (v) =>
    String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

  function colName(index) {
    let n = index + 1;
    let name = "";
    while (n > 0) {
      const r = (n - 1) % 26;
      name = String.fromCharCode(65 + r) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  /* ---------- 样式 ----------
   * 0 默认
   * 1 标题（16pt 加粗，主题色，居中）
   * 2 副标题（10pt 灰色，居中）
   * 3 表头（白字加粗，红底，细边框，居中）
   * 4 正文-居中（细边框）
   * 5 正文-左对齐换行（细边框）
   * 6 金额（¥ #,##0.00，右对齐，细边框）
   * 7 合计（加粗主题色，浅底，右对齐，细边框）
   */
  const FONT = (size, bold, color) =>
    `<font><sz val="${size}"/>${bold ? "<b/>" : ""}<color rgb="${color}"/><name val="宋体"/><charset val="134"/></font>`;
  const FILL = (rgb) =>
    `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const BORDER =
    '<border><left style="thin"><color rgb="FFD9C7B8"/></left><right style="thin"><color rgb="FFD9C7B8"/></right>' +
    '<top style="thin"><color rgb="FFD9C7B8"/></top><bottom style="thin"><color rgb="FFD9C7B8"/></bottom><diagonal/></border>';

  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;¥&quot;#,##0.00"/></numFmts>
<fonts count="6">
${FONT(11, false, "FF333333")}
${FONT(16, true, "FFA3261E")}
${FONT(10, false, "FF777777")}
${FONT(11, true, "FFFFFFFF")}
${FONT(11, true, "FFA3261E")}
${FONT(10, false, "FF333333")}
</fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${FILL(
    "FFFBE9E2"
  )}${FILL("FFFFF7F3")}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${BORDER}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  /* ---------- 工作表 ---------- */
  function buildSheetXml(sheet) {
    const rows = sheet.rows || [];
    const widths = sheet.widths || [];
    const cols = widths.length
      ? `<cols>${widths
          .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
          .join("")}</cols>`
      : "";

    const body = rows
      .map((row, r) => {
        const cells = (row || [])
          .map((cell, c) => {
            const value = cell && typeof cell === "object" ? cell.v : cell;
            const style = cell && typeof cell === "object" && cell.s != null ? cell.s : 0;
            if (value === null || value === undefined || value === "") {
              return style ? `<c r="${colName(c)}${r + 1}" s="${style}"/>` : "";
            }
            const ref = `${colName(c)}${r + 1}`;
            if (typeof value === "number" && Number.isFinite(value)) {
              return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${value}</v></c>`;
            }
            return `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${esc(
              value
            )}</t></is></c>`;
          })
          .join("");
        const height = sheet.rowHeights && sheet.rowHeights[r + 1];
        return `<row r="${r + 1}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells}</row>`;
      })
      .join("");

    const freeze = sheet.freeze
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freeze.ySplit}" topLeftCell="${sheet.freeze.topLeft}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${sheet.freeze.topLeft}" sqref="${sheet.freeze.topLeft}"/></sheetView></sheetViews>`
      : "";
    const merges =
      sheet.merges && sheet.merges.length
        ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
            .map((ref) => `<mergeCell ref="${ref}"/>`)
            .join("")}</mergeCells>`
        : "";
    const filter = sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : "";

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<sheetFormatPr defaultRowHeight="18"/>${cols}<sheetData>${body}</sheetData>${merges}${filter}</worksheet>`;
  }

  /* ---------- 工作簿 ---------- */
  function buildWorkbook(sheets) {
    const list = Array.isArray(sheets) ? sheets : [sheets];
    const sheetTags = list
      .map(
        (s, i) =>
          `<sheet name="${esc(String(s.name || "Sheet" + (i + 1)).slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
      )
      .join("");
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`;

    const rels = list
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join("");
    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${
      list.length + 1
    }" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

    const sheetOverrides = list
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join("");
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

    const files = [
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "_rels/.rels", data: rootRels },
      { name: "xl/workbook.xml", data: workbook },
      { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
      { name: "xl/styles.xml", data: STYLES_XML },
    ];
    list.forEach((sheet, i) => {
      files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: buildSheetXml(sheet) });
    });
    return buildZip(files);
  }

  function downloadBytes(bytes, filename) {
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "礼金明细.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** 兼容旧接口：二维数组 → 单工作表 */
  function download(rows, filename, sheetName, widths) {
    downloadBytes(buildWorkbook([{ name: sheetName || "Sheet1", rows, widths }]), filename);
  }

  /** 新版接口：多工作表 + 样式 */
  function downloadWorkbook(sheets, filename) {
    downloadBytes(buildWorkbook(sheets), filename);
  }

  global.XlsxLite = { build: buildWorkbook, download, downloadWorkbook, _crc32: crc32 };
})(typeof window !== "undefined" ? window : globalThis);

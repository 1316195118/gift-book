/*!
 * 礼簿 · 音色清单（本地随包下发）
 * 自写实现，无第三方依赖。
 *
 * 说明：浏览器朗读用的发音数据由操作系统 / 浏览器自带，网页无法把音频文件搬进页面；
 * 能随包下发的是「音色目录」——地区、性别、音色描述。
 * 页面启动时先用这份清单把下拉框填满（不必等浏览器异步返回 voices），
 * 再把系统实际可用的音色合并进来；系统没装的条目照样可以选，
 * 只是暂时用默认发音代替，装好对应语音包后自动生效。
 */
(function (global) {
  "use strict";

  // 每个地区一份女声、一份男声：[显示名, 语种标签, 关键字...]
  var REGIONS = [
    { region: "普通话", lang: "zh-CN", f: ["晓晓", ["xiaoxiao", "晓晓"]], m: ["云希", ["yunxi", "云希"]] },
    { region: "东北话", lang: "zh-CN-liaoning", f: ["晓北", ["xiaobei", "晓北"]], m: ["云东", ["yundong", "云东"]] },
    { region: "北京话", lang: "zh-CN-beijing", f: ["晓京", ["xiaojing", "晓京"]], m: ["云京", ["yunjing", "云京"]] },
    { region: "天津话", lang: "zh-CN-tianjin", f: ["晓津", ["xiaojin", "晓津"]], m: ["云津", ["yunjin", "云津"]] },
    { region: "河北话", lang: "zh-CN-hebei", f: ["晓冀", ["xiaoyi2", "晓冀"]], m: ["云冀", ["yunji", "云冀"]] },
    { region: "山东话", lang: "zh-CN-shandong", f: ["晓鲁", ["xiaolu", "晓鲁"]], m: ["云鲁", ["yunlu", "云鲁"]] },
    { region: "河南话", lang: "zh-CN-henan", f: ["晓豫", ["xiaoyu2", "晓豫"]], m: ["云豫", ["yunyu", "云豫"]] },
    { region: "陕西话", lang: "zh-CN-shaanxi", f: ["晓妮", ["xiaoni", "晓妮"]], m: ["云秦", ["yunqin", "云秦"]] },
    { region: "山西话", lang: "zh-CN-shanxi", f: ["晓晋", ["xiaojin2", "晓晋"]], m: ["云晋", ["yunjin2", "云晋"]] },
    { region: "甘肃话", lang: "zh-CN-gansu", f: ["晓陇", ["xiaolong", "晓陇"]], m: ["云陇", ["yunlong", "云陇"]] },
    { region: "四川话", lang: "zh-CN-sichuan", f: ["晓川", ["xiaochuan", "sichuan", "晓川", "四川"]], m: ["云川", ["yunchuan", "云川"]] },
    { region: "重庆话", lang: "zh-CN-chongqing", f: ["晓渝", ["xiaoyu3", "chongqing", "晓渝", "重庆"]], m: ["云渝", ["yunyu2", "云渝"]] },
    { region: "云南话", lang: "zh-CN-yunnan", f: ["晓滇", ["xiaodian", "晓滇"]], m: ["云滇", ["yundian", "云滇"]] },
    { region: "贵州话", lang: "zh-CN-guizhou", f: ["晓黔", ["xiaoqian", "晓黔"]], m: ["云黔", ["yunqian", "云黔"]] },
    { region: "湖北话", lang: "zh-CN-hubei", f: ["晓楚", ["xiaochu", "晓楚"]], m: ["云楚", ["yunchu", "云楚"]] },
    { region: "湖南话", lang: "zh-CN-hunan", f: ["晓湘", ["xiaoxiang", "晓湘"]], m: ["云湘", ["yunxiang", "云湘"]] },
    { region: "江西话", lang: "zh-CN-jiangxi", f: ["晓赣", ["xiaogan", "晓赣"]], m: ["云赣", ["yungan", "云赣"]] },
    { region: "安徽话", lang: "zh-CN-anhui", f: ["晓皖", ["xiaowan", "晓皖"]], m: ["云皖", ["yunwan", "云皖"]] },
    { region: "江苏话", lang: "zh-CN-jiangsu", f: ["晓苏", ["xiaosu", "晓苏"]], m: ["云苏", ["yunsu", "云苏"]] },
    { region: "上海话", lang: "zh-CN-shanghai", f: ["晓沪", ["xiaohu", "晓沪"]], m: ["云沪", ["yunhu", "云沪"]] },
    { region: "浙江话", lang: "zh-CN-zhejiang", f: ["晓越", ["xiaoyue", "晓越"]], m: ["云越", ["yunyue", "云越"]] },
    { region: "福建话", lang: "zh-CN-fujian", f: ["晓闽", ["xiaomin", "晓闽", "闽南"]], m: ["云闽", ["yunmin", "云闽"]] },
    { region: "客家话", lang: "zh-CN-hakka", f: ["晓客", ["xiaoke", "晓客", "客家"]], m: ["云客", ["yunke", "云客"]] },
    { region: "广西话", lang: "zh-CN-guangxi", f: ["晓桂", ["xiaogui", "晓桂", "桂柳"]], m: ["云桂", ["yungui", "云桂"]] },
    { region: "海南话", lang: "zh-CN-hainan", f: ["晓琼", ["xiaoqiong", "晓琼"]], m: ["云琼", ["yunqiong", "云琼"]] },
    { region: "粤语", lang: "zh-HK", f: ["曉佳", ["hiugaai", "曉佳"]], m: ["雲龍", ["wanlung", "雲龍"]] },
    { region: "台湾国语", lang: "zh-TW", f: ["曉臻", ["hsiaochen", "曉臻"]], m: ["云哲", ["yunje", "云哲"]] }
  ];

  // 系统里常见的通用音色（不绑地区，装了就出现在「本机可用」）
  var GENERIC = [
    { id: "xiaoyi", name: "晓伊", tone: "甜美女声", lang: "zh-CN", gentle: true, keys: ["xiaoyi", "晓伊"] },
    { id: "xiaomo", name: "晓墨", tone: "知性女声", lang: "zh-CN", gentle: true, keys: ["xiaomo", "晓墨"] },
    { id: "xiaohan", name: "晓涵", tone: "柔和女声", lang: "zh-CN", gentle: true, keys: ["xiaohan", "晓涵"] },
    { id: "xiaoxuan", name: "晓萱", tone: "明亮女声", lang: "zh-CN", gentle: false, keys: ["xiaoxuan", "晓萱"] },
    { id: "xiaoyou", name: "晓悠", tone: "舒缓女声", lang: "zh-CN", gentle: true, keys: ["xiaoyou", "晓悠"] },
    { id: "xiaorui", name: "晓睿", tone: "沉静女声", lang: "zh-CN", gentle: true, keys: ["xiaorui", "晓睿"] },
    { id: "huihui", name: "慧慧", tone: "温和女声", lang: "zh-CN", gentle: true, keys: ["huihui", "慧慧"] },
    { id: "yaoyao", name: "瑶瑶", tone: "轻柔女声", lang: "zh-CN", gentle: true, keys: ["yaoyao", "瑶瑶"] },
    { id: "tingting", name: "婷婷", tone: "标准女声", lang: "zh-CN", gentle: false, keys: ["ting-ting", "tingting", "婷婷"] },
    { id: "meijia", name: "美佳", tone: "台湾女声", lang: "zh-TW", gentle: true, keys: ["mei-jia", "meijia", "美佳"] },
    { id: "sinji", name: "善怡", tone: "粤语女声", lang: "zh-HK", gentle: true, keys: ["sin-ji", "sinji", "善怡"] },
    { id: "hiumaan", name: "曉曼", tone: "粤语女声", lang: "zh-HK", gentle: true, keys: ["hiumaan", "曉曼"] },
    { id: "yunyang", name: "云扬", tone: "沉稳男声", lang: "zh-CN", gentle: false, keys: ["yunyang", "云扬"] },
    { id: "yunjian", name: "云健", tone: "浑厚男声", lang: "zh-CN", gentle: false, keys: ["yunjian", "云健"] },
    { id: "yunxia", name: "云夏", tone: "清亮少年", lang: "zh-CN", gentle: false, keys: ["yunxia", "云夏"] },
    { id: "yunfeng", name: "云枫", tone: "温和男声", lang: "zh-CN", gentle: true, keys: ["yunfeng", "云枫"] },
    { id: "kangkang", name: "康康", tone: "标准男声", lang: "zh-CN", gentle: false, keys: ["kangkang", "康康"] },
    { id: "google", name: "普通话", tone: "系统默认", lang: "zh-CN", gentle: false, keys: ["google 普通话", "google zh", "普通话"] }
  ];

  var MANIFEST = [];

  REGIONS.forEach(function (item, index) {
    MANIFEST.push({
      id: "f-" + item.lang.toLowerCase(),
      name: item.f[0],
      tone: item.region + "女声",
      region: item.region,
      gender: "f",
      gentle: true,
      lang: item.lang,
      keys: item.f[1]
    });
    MANIFEST.push({
      id: "m-" + item.lang.toLowerCase(),
      name: item.m[0],
      tone: item.region + "男声",
      region: item.region,
      gender: "m",
      gentle: false,
      lang: item.lang,
      keys: item.m[1]
    });
  });
  // 普通话的女声放最前，其余通用音色附在末尾
  GENERIC.forEach(function (item) {
    MANIFEST.push(Object.assign({ region: "通用", gender: "" }, item));
  });

  var byLangExact = {};
  var byKey = {};
  var byId = {};
  var zhCN = null;
  var zhCNMale = null;
  var zhHK = null;
  var zhTW = null;

  MANIFEST.forEach(function (item, index) {
    item.rank = index;
    item.gentle = Boolean(item.gentle);
    var lang = String(item.lang || "").toLowerCase();
    if (lang && !byLangExact[lang]) byLangExact[lang] = item;
    if (!byId[item.id]) byId[item.id] = item;
    (item.keys || []).forEach(function (key) {
      var k = String(key).toLowerCase();
      if (k && !byKey[k]) byKey[k] = item;
    });
    if (lang === "zh-cn" && !zhCN) zhCN = item;
    if (item.id === "m-zh-cn") zhCNMale = item;
    if (lang === "zh-hk" && !zhHK) zhHK = item;
    if (lang === "zh-tw" && !zhTW) zhTW = item;
  });

  /** 名字里带云/康的多半是男声，带晓/慧/瑶的多半是女声。 */
  function looksMale(name) {
    return /yun|kang|云|康|男/i.test(name);
  }

  /** 命中的条目性别不符时，换成同语言的另一份。 */
  function withGender(item, male, lang) {
    if (!item) return null;
    var other = null;
    if (male && item.gender === "f") other = byId["m-" + lang];
    if (!male && item.gender === "m") other = byId["f-" + lang];
    return other || item;
  }

  /**
   * 按语音对象（或 {name, lang}）找清单条目。
   * 顺序：完整方言标签（zh-CN-sichuan）→ 名称关键字（Huihui / Yunxi…）→ zh-CN / zh-HK / zh-TW。
   * 这样 Huihui、Kangkang、Yaoyao 这类系统音色不会被统统归成「晓晓」。
   */
  function lookup(voice) {
    if (!voice) return null;
    var lang = String(voice.lang || "").toLowerCase();
    var name = String(voice.name || "").toLowerCase();
    var male = looksMale(name);

    // 1. 具体方言标签（三段式，如 zh-cn-sichuan）
    if (lang && lang.split("-").length >= 3 && byLangExact[lang]) {
      return withGender(byLangExact[lang], male, lang);
    }

    // 2. 名称关键字
    var keys = Object.keys(byKey);
    for (var i = 0; i < keys.length; i++) {
      if (name.indexOf(keys[i]) !== -1) return byKey[keys[i]];
    }

    // 3. 语言标签兜底
    if (!lang) return null;
    if (lang.indexOf("zh-hk") === 0 || lang.indexOf("zh-mo") === 0) return withGender(zhHK, male, "zh-hk");
    if (lang.indexOf("zh-tw") === 0) return withGender(zhTW, male, "zh-tw");
    if (lang.indexOf("zh") === 0) return withGender(zhCN, male, "zh-cn");
    return null;
  }

  global.LEDGER_VOICE_MANIFEST = MANIFEST;
  global.LedgerVoiceCatalog = {
    list: MANIFEST,
    lookup: lookup,
    size: MANIFEST.length,
    regions: REGIONS.map(function (r) { return r.region; }),
    /** 方言名单（用于提示已装/未装） */
    dialects: REGIONS.filter(function (r) { return r.region !== "普通话"; }).map(function (r) { return r.region; })
  };
})(typeof window !== "undefined" ? window : this);

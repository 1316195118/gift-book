/*!
 * ledger-crypto.js —— 礼簿自研加密层（无第三方库）
 *
 * 提供三件事：
 *   1. sha256(text) -> hex      账簿密码摘要
 *   2. encrypt(text, pass)      生成与历史数据同格式的密文（"Salted__" + salt + AES-256-CBC，Base64）
 *   3. decrypt(cipher, pass)    解出明文，失败返回 null
 *
 * 兼容性说明：历史数据由 OpenSSL 兼容格式写入（EVP_BytesToKey/MD5 派生密钥），
 * 这里按同样的算法自行实现，保证旧账簿仍能解开、新写入的数据格式不变。
 * 全部为同步实现，不依赖 Web Crypto（局域网 http 环境下 crypto.subtle 不可用）。
 *
 * 版权与来源：本文件为本项目自行编写（MIT，见仓库 LICENSE），未引用任何第三方
 * 实现的代码。所实现的算法均来自公开标准，算法本身不受著作权保护：
 *   MD5 = RFC 1321，SHA-256 = FIPS 180-4，AES = FIPS 197，CBC/PKCS#7 = SP 800-38A / RFC 5652，
 *   HMAC = RFC 2104 / FIPS 198-1，PBKDF2 = RFC 8018。
 */
(function (global) {
  "use strict";

  /* ---------------- 字节与 Base64 ---------------- */

  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function bytesToBase64(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      out += B64[b0 >> 2];
      out += B64[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
      out += b1 === undefined ? "=" : B64[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
      out += b2 === undefined ? "=" : B64[b2 & 63];
    }
    return out;
  }

  function base64ToBytes(text) {
    const clean = String(text).replace(/[^A-Za-z0-9+/=]/g, "");
    const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
    const out = new Uint8Array((clean.length / 4) * 3 - pad);
    let o = 0;
    for (let i = 0; i < clean.length; i += 4) {
      const n =
        (B64.indexOf(clean[i]) << 18) |
        (B64.indexOf(clean[i + 1]) << 12) |
        ((B64.indexOf(clean[i + 2]) & 63) << 6) |
        (B64.indexOf(clean[i + 3]) & 63);
      out[o++] = (n >> 16) & 255;
      if (o < out.length) out[o++] = (n >> 8) & 255;
      if (o < out.length) out[o++] = n & 255;
    }
    return out;
  }

  const utf8Encode = (text) => new TextEncoder().encode(String(text));
  const utf8Decode = (bytes) => new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  /* ---------------- MD5（EVP_BytesToKey 需要） ---------------- */

  const MD5_K = new Uint32Array(64);
  for (let i = 0; i < 64; i += 1) {
    MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  }
  const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  function md5(input) {
    const msg = input instanceof Uint8Array ? input : utf8Encode(input);
    const withPad = new Uint8Array((((msg.length + 8) >> 6) + 1) * 64);
    withPad.set(msg);
    withPad[msg.length] = 0x80;
    const dv = new DataView(withPad.buffer);
    const bits = msg.length * 8;
    dv.setUint32(withPad.length - 8, bits >>> 0, true);
    dv.setUint32(withPad.length - 4, Math.floor(bits / 4294967296), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let off = 0; off < withPad.length; off += 64) {
      const M = new Uint32Array(16);
      for (let i = 0; i < 16; i += 1) M[i] = dv.getUint32(off + i * 4, true);
      let A = a0;
      let B = b0;
      let C = c0;
      let D = d0;
      for (let i = 0; i < 64; i += 1) {
        let F;
        let g;
        if (i < 16) {
          F = (B & C) | (~B & D);
          g = i;
        } else if (i < 32) {
          F = (D & B) | (~D & C);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          F = B ^ C ^ D;
          g = (3 * i + 5) % 16;
        } else {
          F = C ^ (B | ~D);
          g = (7 * i) % 16;
        }
        const tmp = D;
        D = C;
        C = B;
        const sum = (A + F + MD5_K[i] + M[g]) >>> 0;
        B = (B + ((sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i])))) >>> 0;
        A = tmp;
      }
      a0 = (a0 + A) >>> 0;
      b0 = (b0 + B) >>> 0;
      c0 = (c0 + C) >>> 0;
      d0 = (d0 + D) >>> 0;
    }

    const out = new Uint8Array(16);
    const odv = new DataView(out.buffer);
    odv.setUint32(0, a0, true);
    odv.setUint32(4, b0, true);
    odv.setUint32(8, c0, true);
    odv.setUint32(12, d0, true);
    return out;
  }

  /* ---------------- SHA-256 ---------------- */

  const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function sha256(input) {
    const msg = input instanceof Uint8Array ? input : utf8Encode(input);
    const withPad = new Uint8Array((((msg.length + 9) >> 6) + 1) * 64);
    withPad.set(msg);
    withPad[msg.length] = 0x80;
    const dv = new DataView(withPad.buffer);
    const bits = msg.length * 8;
    dv.setUint32(withPad.length - 8, Math.floor(bits / 4294967296), false);
    dv.setUint32(withPad.length - 4, bits >>> 0, false);

    const H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const W = new Uint32Array(64);
    const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

    for (let off = 0; off < withPad.length; off += 64) {
      for (let i = 0; i < 16; i += 1) W[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i += 1) {
        const s0 = (rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10)) >>> 0;
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i += 1) {
        const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
        const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }

    let hex = "";
    for (let i = 0; i < 8; i += 1) hex += H[i].toString(16).padStart(8, "0");
    return hex;
  }

  /* ---------------- SHA-256 原始字节 / HMAC / PBKDF2（v2 加密用） ---------------- */

  const SHA256_IV = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const CW = new Uint32Array(64);
  /** 单个 64 字节块的压缩函数：就地更新 state（8 个字），block 为 16 个大端字。 */
  function compress(state, block) {
    for (let i = 0; i < 16; i += 1) CW[i] = block[i];
    for (let i = 16; i < 64; i += 1) {
      const x = CW[i - 15], y = CW[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      CW[i] = (CW[i - 16] + s0 + CW[i - 7] + s1) | 0;
    }
    let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + SHA256_K[i] + CW[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    state[0] += a; state[1] += b; state[2] += c; state[3] += d;
    state[4] += e; state[5] += f; state[6] += g; state[7] += h;
  }
  function wordsToBytes(words) {
    const out = new Uint8Array(words.length * 4);
    for (let i = 0; i < words.length; i += 1) {
      out[i * 4] = words[i] >>> 24; out[i * 4 + 1] = words[i] >>> 16; out[i * 4 + 2] = words[i] >>> 8; out[i * 4 + 3] = words[i];
    }
    return out;
  }
  /** SHA-256，返回 32 字节；prefixState/prefixLen 用于 HMAC 预计算的内外层状态。 */
  function sha256Raw(msg, prefixState, prefixLen = 0) {
    const state = Uint32Array.from(prefixState || SHA256_IV);
    const total = msg.length + 9;
    const padded = new Uint8Array(Math.ceil(total / 64) * 64);
    padded.set(msg);
    padded[msg.length] = 0x80;
    const bits = (msg.length + prefixLen) * 8;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(bits / 4294967296), false);
    dv.setUint32(padded.length - 4, bits >>> 0, false);
    const block = new Uint32Array(16);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i += 1) block[i] = dv.getUint32(off + i * 4, false);
      compress(state, block);
    }
    return wordsToBytes(state);
  }
  function hmacStates(key) {
    let k = key.length > 64 ? sha256Raw(key) : key;
    const ipad = new Uint8Array(64).fill(0x36), opad = new Uint8Array(64).fill(0x5c);
    for (let i = 0; i < k.length; i += 1) { ipad[i] ^= k[i]; opad[i] ^= k[i]; }
    const toWords = (bytes) => { const dv = new DataView(bytes.buffer); const w = new Uint32Array(16); for (let i = 0; i < 16; i += 1) w[i] = dv.getUint32(i * 4, false); return w; };
    const inner = Uint32Array.from(SHA256_IV), outer = Uint32Array.from(SHA256_IV);
    compress(inner, toWords(ipad));
    compress(outer, toWords(opad));
    return { inner, outer };
  }
  function hmacSha256(key, msg) {
    const { inner, outer } = hmacStates(key);
    return sha256Raw(sha256Raw(msg, inner, 64), outer, 64);
  }
  /** PBKDF2-HMAC-SHA256，输出 32 字节（单块），内循环预计算内外层状态。 */
  function pbkdf2Sha256(password, salt, iterations) {
    const { inner, outer } = hmacStates(password);
    const first = new Uint8Array(salt.length + 4);
    first.set(salt);
    first[salt.length + 3] = 1;
    let u = sha256Raw(sha256Raw(first, inner, 64), outer, 64);
    const t = new Uint32Array(8), uw = new Uint32Array(8);
    const dv = new DataView(u.buffer);
    for (let i = 0; i < 8; i += 1) { uw[i] = dv.getUint32(i * 4, false); t[i] = uw[i]; }
    // 32 字节消息接在 64 字节前缀之后：固定的单块填充，长度 (64+32)*8 = 768 位
    const block = new Uint32Array(16);
    const st = new Uint32Array(8);
    for (let n = 1; n < iterations; n += 1) {
      for (let i = 0; i < 8; i += 1) block[i] = uw[i];
      block[8] = 0x80000000; for (let i = 9; i < 15; i += 1) block[i] = 0; block[15] = 768;
      st.set(inner); compress(st, block);
      for (let i = 0; i < 8; i += 1) block[i] = st[i];
      block[8] = 0x80000000; for (let i = 9; i < 15; i += 1) block[i] = 0; block[15] = 768;
      st.set(outer); compress(st, block);
      for (let i = 0; i < 8; i += 1) { uw[i] = st[i]; t[i] ^= st[i]; }
    }
    return wordsToBytes(t);
  }

  /* ---------------- AES-256（纯 JS，CBC + PKCS#7） ---------------- */

  function gmul(a, b) {
    let p = 0;
    for (let i = 0; i < 8; i += 1) {
      if (b & 1) p ^= a;
      const hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p;
  }

  const rotl8 = (x, n) => ((x << n) | (x >>> (8 - n))) & 0xff;

  // S 盒用「乘法逆元 + 仿射变换」现场生成，避免手写 256 个常量出错
  const SBOX = new Uint8Array(256);
  (function buildSbox() {
    const inv = new Uint8Array(256);
    for (let a = 1; a < 256; a += 1) {
      for (let b = 1; b < 256; b += 1) {
        if (gmul(a, b) === 1) { inv[a] = b; break; }
      }
    }
    for (let a = 0; a < 256; a += 1) {
      const x = inv[a];
      SBOX[a] = (x ^ rotl8(x, 1) ^ rotl8(x, 2) ^ rotl8(x, 3) ^ rotl8(x, 4) ^ 0x63) & 0xff;
    }
  })();

  const INV_SBOX = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) INV_SBOX[SBOX[i]] = i;

  function expandKey256(key) {
    const Nk = 8;
    const Nr = 14;
    const words = new Uint32Array(4 * (Nr + 1));
    for (let i = 0; i < Nk; i += 1) {
      words[i] = (key[i * 4] << 24) | (key[i * 4 + 1] << 16) | (key[i * 4 + 2] << 8) | key[i * 4 + 3];
    }
    let rcon = 1;
    for (let i = Nk; i < words.length; i += 1) {
      let temp = words[i - 1];
      if (i % Nk === 0) {
        temp = ((temp << 8) | (temp >>> 24)) >>> 0;
        temp =
          (SBOX[(temp >>> 24) & 0xff] << 24) |
          (SBOX[(temp >>> 16) & 0xff] << 16) |
          (SBOX[(temp >>> 8) & 0xff] << 8) |
          SBOX[temp & 0xff];
        temp = (temp ^ (rcon << 24)) >>> 0;
        rcon = gmul(rcon, 2);
      } else if (i % Nk === 4) {
        temp =
          (SBOX[(temp >>> 24) & 0xff] << 24) |
          (SBOX[(temp >>> 16) & 0xff] << 16) |
          (SBOX[(temp >>> 8) & 0xff] << 8) |
          SBOX[temp & 0xff];
      }
      words[i] = (words[i - Nk] ^ temp) >>> 0;
    }
    return { words, Nr };
  }

  function addRoundKey(state, words, round) {
    for (let c = 0; c < 4; c += 1) {
      const w = words[round * 4 + c];
      state[c * 4] ^= (w >>> 24) & 0xff;
      state[c * 4 + 1] ^= (w >>> 16) & 0xff;
      state[c * 4 + 2] ^= (w >>> 8) & 0xff;
      state[c * 4 + 3] ^= w & 0xff;
    }
  }

  function encryptBlock(block, words, Nr) {
    const s = Uint8Array.from(block);
    addRoundKey(s, words, 0);
    for (let round = 1; round <= Nr; round += 1) {
      for (let i = 0; i < 16; i += 1) s[i] = SBOX[s[i]];
      // ShiftRows（列主序：s[c*4+r]）
      let t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
      t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
      t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
      if (round !== Nr) {
        for (let c = 0; c < 4; c += 1) {
          const i = c * 4;
          const a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
          s[i] = gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3;
          s[i + 1] = a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3;
          s[i + 2] = a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3);
          s[i + 3] = gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2);
        }
      }
      addRoundKey(s, words, round);
    }
    return s;
  }

  function decryptBlock(block, words, Nr) {
    const s = Uint8Array.from(block);
    addRoundKey(s, words, Nr);
    for (let round = Nr - 1; round >= 0; round -= 1) {
      // InvShiftRows
      let t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
      t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
      t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
      for (let i = 0; i < 16; i += 1) s[i] = INV_SBOX[s[i]];
      addRoundKey(s, words, round);
      if (round !== 0) {
        for (let c = 0; c < 4; c += 1) {
          const i = c * 4;
          const a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
          s[i] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
          s[i + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
          s[i + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
          s[i + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
        }
      }
    }
    return s;
  }

  function cbcEncrypt(plain, key, iv) {
    const { words, Nr } = expandKey256(key);
    const padLen = 16 - (plain.length % 16);
    const data = new Uint8Array(plain.length + padLen);
    data.set(plain);
    data.fill(padLen, plain.length);
    const out = new Uint8Array(data.length);
    let prev = Uint8Array.from(iv);
    for (let off = 0; off < data.length; off += 16) {
      const block = new Uint8Array(16);
      for (let i = 0; i < 16; i += 1) block[i] = data[off + i] ^ prev[i];
      const enc = encryptBlock(block, words, Nr);
      out.set(enc, off);
      prev = enc;
    }
    return out;
  }

  function cbcDecrypt(cipher, key, iv) {
    const { words, Nr } = expandKey256(key);
    const out = new Uint8Array(cipher.length);
    let prev = Uint8Array.from(iv);
    for (let off = 0; off < cipher.length; off += 16) {
      const block = cipher.subarray(off, off + 16);
      const dec = decryptBlock(block, words, Nr);
      for (let i = 0; i < 16; i += 1) out[off + i] = dec[i] ^ prev[i];
      prev = Uint8Array.from(block);
    }
    const pad = out[out.length - 1];
    if (pad < 1 || pad > 16) return null;
    for (let i = out.length - pad; i < out.length; i += 1) if (out[i] !== pad) return null;
    return out.subarray(0, out.length - pad);
  }

  /* ---------------- OpenSSL 兼容封装 ---------------- */

  function evpBytesToKey(passBytes, salt, need) {
    const parts = [];
    let prev = new Uint8Array(0);
    let total = 0;
    while (total < need) {
      const buf = new Uint8Array(prev.length + passBytes.length + salt.length);
      buf.set(prev, 0);
      buf.set(passBytes, prev.length);
      buf.set(salt, prev.length + passBytes.length);
      prev = md5(buf);
      parts.push(prev);
      total += prev.length;
    }
    const out = new Uint8Array(total);
    let o = 0;
    parts.forEach((p) => { out.set(p, o); o += p.length; });
    return out.subarray(0, need);
  }

  function randomSalt() {
    const salt = new Uint8Array(8);
    if (global.crypto && typeof global.crypto.getRandomValues === "function") {
      global.crypto.getRandomValues(salt);
    } else {
      for (let i = 0; i < 8; i += 1) salt[i] = Math.floor(Math.random() * 256);
    }
    return salt;
  }

  function encrypt(text, passphrase) {
    // 传入 deriveKeys() 的结果时写 v2；传入字符串时写旧格式（无密码账簿、会话恢复）。
    if (passphrase && typeof passphrase === "object" && passphrase.v === 2) return encryptV2(text, passphrase);
    const pass = utf8Encode(passphrase == null ? "" : passphrase);
    const salt = randomSalt();
    const keyIv = evpBytesToKey(pass, salt, 48);
    const key = keyIv.subarray(0, 32);
    const iv = keyIv.subarray(32, 48);
    const cipher = cbcEncrypt(utf8Encode(text), key, iv);
    const out = new Uint8Array(16 + cipher.length);
    out.set(utf8Encode("Salted__"), 0);
    out.set(salt, 8);
    out.set(cipher, 16);
    return bytesToBase64(out);
  }

  /* ---------------- v2：每本账簿 PBKDF2 派生密钥 + AES-256-CBC + HMAC-SHA256 ---------------- */
  // 记录格式（Base64）："GBv2"(4) + IV(16) + 密文 + HMAC(32)，先加密后认证。
  const V2_MAGIC = new Uint8Array([0x47, 0x42, 0x76, 0x32]);
  const V2_ITERATIONS = 310000;

  function randomBytes(n) {
    if (!global.crypto || typeof global.crypto.getRandomValues !== "function") throw new Error("当前浏览器不支持安全随机数，无法加密");
    const out = new Uint8Array(n);
    global.crypto.getRandomValues(out);
    return out;
  }

  /** 新账簿或首次升级时生成的公开参数（盐不保密，只要求每本不同）。 */
  function newKdfParams(iterations = V2_ITERATIONS) {
    return { v: 2, alg: "pbkdf2-sha256", iter: iterations, salt: bytesToBase64(randomBytes(16)) };
  }

  /**
   * 由管理密码与账簿参数派生密钥。耗时（约数百毫秒），每次解锁只做一次。
   * 返回的上下文同时保留原密码，用于解开升级前的旧格式记录。
   */
  function deriveKeys(passphrase, params) {
    if (!params || params.v !== 2 || params.alg !== "pbkdf2-sha256") throw new Error("不支持的密钥参数");
    const salt = base64ToBytes(params.salt);
    const iter = Number(params.iter);
    if (salt.length !== 16 || !Number.isInteger(iter) || iter < 100000 || iter > 5000000) throw new Error("密钥参数无效");
    const master = pbkdf2Sha256(utf8Encode(passphrase == null ? "" : passphrase), salt, iter);
    return {
      v: 2,
      password: passphrase,
      enc: hmacSha256(master, utf8Encode("giftbook-v2-enc")),
      mac: hmacSha256(master, utf8Encode("giftbook-v2-mac")),
    };
  }

  function isV2(cipherText) {
    try {
      const head = base64ToBytes(String(cipherText).slice(0, 8));
      return head.length >= 4 && head[0] === 0x47 && head[1] === 0x42 && head[2] === 0x76 && head[3] === 0x32;
    } catch (e) {
      return false;
    }
  }

  function encryptV2(text, keys) {
    const iv = randomBytes(16);
    const cipher = cbcEncrypt(utf8Encode(text), keys.enc, iv);
    const body = new Uint8Array(4 + 16 + cipher.length);
    body.set(V2_MAGIC, 0); body.set(iv, 4); body.set(cipher, 20);
    const tag = hmacSha256(keys.mac, body);
    const out = new Uint8Array(body.length + 32);
    out.set(body, 0); out.set(tag, body.length);
    return bytesToBase64(out);
  }

  function decryptV2(raw, keys) {
    if (!keys || !keys.enc || !keys.mac) return null;
    if (raw.length < 4 + 16 + 16 + 32 || (raw.length - 52) % 16 !== 0) return null;
    const body = raw.subarray(0, raw.length - 32), tag = raw.subarray(raw.length - 32);
    const expect = hmacSha256(keys.mac, body);
    let diff = 0;
    for (let i = 0; i < 32; i += 1) diff |= expect[i] ^ tag[i];
    if (diff !== 0) return null; // 密码不对或数据被篡改
    const plain = cbcDecrypt(body.subarray(20), keys.enc, body.subarray(4, 20));
    return plain ? utf8Decode(plain) : null;
  }

  function decrypt(cipherText, passphrase) {
    try {
      const raw = base64ToBytes(cipherText);
      if (raw.length >= 4 && raw[0] === 0x47 && raw[1] === 0x42 && raw[2] === 0x76 && raw[3] === 0x32) {
        return decryptV2(raw, passphrase && typeof passphrase === "object" ? passphrase : null);
      }
      if (passphrase && typeof passphrase === "object") passphrase = passphrase.password;
      const pass = utf8Encode(passphrase == null ? "" : passphrase);
      if (raw.length < 32) return null;
      const magic = utf8Decode(raw.subarray(0, 8));
      if (magic !== "Salted__") return null;
      const salt = raw.subarray(8, 16);
      const keyIv = evpBytesToKey(pass, salt, 48);
      const plain = cbcDecrypt(raw.subarray(16), keyIv.subarray(0, 32), keyIv.subarray(32, 48));
      if (!plain) return null;
      return utf8Decode(plain);
    } catch (err) {
      return null;
    }
  }

  global.LedgerCrypto = {
    sha256,
    encrypt,
    decrypt,
    newKdfParams,
    deriveKeys,
    isV2,
    hmacSha256Hex: (key, msg) => Array.from(hmacSha256(utf8Encode(key), utf8Encode(msg))).map((b) => b.toString(16).padStart(2, "0")).join(""),
    // 用派生出的原始密钥字节做 HMAC：离线校验凭据用，不可反推出密码
    hmacSha256Hex2: (keyBytes, msg) => Array.from(hmacSha256(keyBytes, utf8Encode(msg))).map((b) => b.toString(16).padStart(2, "0")).join(""),
    pbkdf2Hex: (password, saltText, iterations) => Array.from(pbkdf2Sha256(utf8Encode(password), utf8Encode(saltText), iterations)).map((b) => b.toString(16).padStart(2, "0")).join(""),
    // 便于自检的底层方法
    _md5Hex: (text) => Array.from(md5(text)).map((b) => b.toString(16).padStart(2, "0")).join(""),
  };
})(typeof window !== "undefined" ? window : globalThis);

// Google Authenticator migration format encoder/decoder
// otpauth-migration://offline?data=<base64-protobuf>
//
// Protobuf schema (Google Authenticator):
//   message MigrationPayload {
//     repeated OtpParameters otp_parameters = 1;
//     int32 version = 2;
//     int32 batch_size = 3;
//     int32 batch_index = 4;
//     int32 batch_id = 5;
//   }
//   message OtpParameters {
//     bytes secret = 1;
//     string name = 2;
//     string issuer = 3;
//     Algorithm algorithm = 4;
//     DigitCount digits = 5;
//     OtpType type = 6;
//     int64 counter = 7;
//   }
//   enum Algorithm { UNSPECIFIED=0, SHA1=1, SHA256=2, SHA512=3, MD5=4 }
//   enum DigitCount { UNSPECIFIED=0, SIX=1, EIGHT=2 }
//   enum OtpType    { UNSPECIFIED=0, HOTP=1, TOTP=2 }

(function (global) {
  'use strict';

  // ---------- 1. Base32 디코더 (재사용용, totp.js와 동일 로직) ----------
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function base32Decode(input) {
    const clean = String(input || '').replace(/\s+/g, '').replace(/-/g, '').replace(/=+$/g, '').toUpperCase();
    if (!clean) throw new Error('빈 시크릿');
    if (!/^[A-Z2-7]+$/.test(clean)) throw new Error('Base32 형식이 아닙니다');
    let bits = 0, value = 0;
    const out = [];
    for (let i = 0; i < clean.length; i++) {
      const idx = B32.indexOf(clean[i]);
      if (idx < 0) throw new Error('Base32 디코딩 실패');
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    return new Uint8Array(out);
  }

  // ---------- 2. Base32 인코더 (디코딩한 secret을 Base32로 복원) ----------
  function base32Encode(bytes) {
    let bits = 0, value = 0, out = '';
    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        out += B32[(value >>> (bits - 5)) & 0x1f];
        bits -= 5;
      }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 0x1f];
    return out;
  }

  // ---------- 3. Protobuf 기본 (Wire format) ----------
  // wire types: 0=varint, 2=length-delimited
  function encVarint(n) {
    if (n < 0) throw new Error('음수 미지원');
    const bytes = [];
    while (n > 0x7f) { bytes.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    bytes.push(n & 0x7f);
    return bytes;
  }
  function encTag(fieldNum, wireType) {
    return encVarint((fieldNum << 3) | wireType);
  }
  function encBytes(fieldNum, bytes) {
    const out = encTag(fieldNum, 2);
    out.push(...encVarint(bytes.length));
    for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
    return out;
  }
  function encString(fieldNum, str) {
    const utf8 = new TextEncoder().encode(str);
    return encBytes(fieldNum, utf8);
  }
  function encUint(fieldNum, val) {
    return [...encTag(fieldNum, 0), ...encVarint(val)];
  }

  // 디코더 (라운드트립 테스트/검증용)
  function decVarint(buf, pos) {
    let result = 0, shift = 0, p = pos;
    while (true) {
      const b = buf[p++];
      result |= (b & 0x7f) * Math.pow(2, shift); // bitwise OR can overflow for large
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return { value: result, pos: p };
  }

  function decodeMigrationPayload(bytes) {
    const result = { otp_parameters: [], version: 0, batch_size: 0, batch_index: 0, batch_id: 0 };
    let p = 0;
    while (p < bytes.length) {
      const t = decVarint(bytes, p); p = t.pos;
      const field = t.value >>> 3;
      const wire = t.value & 0x7;
      if (wire === 0) {
        const v = decVarint(bytes, p); p = v.pos;
        if (field === 2) result.version = v.value;
        else if (field === 3) result.batch_size = v.value;
        else if (field === 4) result.batch_index = v.value;
        else if (field === 5) result.batch_id = v.value;
      } else if (wire === 2) {
        const l = decVarint(bytes, p); p = l.pos;
        const sub = bytes.subarray(p, p + l.value); p += l.value;
        if (field === 1) result.otp_parameters.push(decodeOtpParameters(sub));
      } else {
        throw new Error('unsupported wire type ' + wire);
      }
    }
    return result;
  }

  function decodeOtpParameters(bytes) {
    const result = { secret: new Uint8Array(0), name: '', issuer: '', algorithm: 0, digits: 0, type: 0, counter: 0 };
    let p = 0;
    while (p < bytes.length) {
      const t = decVarint(bytes, p); p = t.pos;
      const field = t.value >>> 3;
      const wire = t.value & 0x7;
      if (wire === 0) {
        const v = decVarint(bytes, p); p = v.pos;
        if (field === 4) result.algorithm = v.value;
        else if (field === 5) result.digits = v.value;
        else if (field === 6) result.type = v.value;
        else if (field === 7) result.counter = v.value;
      } else if (wire === 2) {
        const l = decVarint(bytes, p); p = l.pos;
        const sub = bytes.subarray(p, p + l.value); p += l.value;
        if (field === 1) result.secret = sub;
        else if (field === 2) result.name = new TextDecoder().decode(sub);
        else if (field === 3) result.issuer = new TextDecoder().decode(sub);
      }
    }
    return result;
  }

  // ---------- 4. Entry → OtpParameters 인코딩 ----------
  // entry: { label, issuer, secret (Base32), digits, period, algorithm, type? }
  function encodeOtpParameters(entry) {
    const out = [];
    const secretBytes = base32Decode(entry.secret);
    out.push(...encBytes(1, secretBytes));        // secret
    if (entry.label)  out.push(...encString(2, entry.label));   // name
    if (entry.issuer) out.push(...encString(3, entry.issuer));  // issuer

    // algorithm: SHA1=1, SHA256=2, SHA512=3
    const algoMap = { SHA1: 1, SHA256: 2, SHA512: 3, MD5: 4 };
    const algo = algoMap[(entry.algorithm || 'SHA1').toUpperCase()] || 1;
    out.push(...encUint(4, algo));

    // digits: 6=1, 8=2 (Google Authenticator는 6/8만 지원)
    let dig = 1;
    if (entry.digits === 8) dig = 2;
    out.push(...encUint(5, dig));

    // type: TOTP=2, HOTP=1
    const otpType = (entry.type === 'hotp') ? 1 : 2;
    out.push(...encUint(6, otpType));

    if (otpType === 1 && entry.counter) {
      out.push(...encUint(7, entry.counter));
    }
    return new Uint8Array(out);
  }

  function encodeMigrationPayload(entries, { batchId = 0, batchSize = 1, batchIndex = 0, version = 1 } = {}) {
    const out = [];
    for (const e of entries) {
      const otp = encodeOtpParameters(e);
      out.push(...encBytes(1, otp));
    }
    out.push(...encUint(2, version));
    out.push(...encUint(3, batchSize));
    out.push(...encUint(4, batchIndex));
    out.push(...encUint(5, batchId));
    return new Uint8Array(out);
  }

  // ---------- 5. Base64 encoder ----------
  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  // ---------- 6. 배치 자동 분할 (QR 용량 한계까지 채움) ----------
  // QR 코드 (Byte, ECC L, version 40) 최대 약 2953바이트.
  // 안전 마진 + URI prefix(~35자) + Base64 오버헤드(~4/3) 고려:
  // 페이로드 바이트 한계는 약 ~2100 정도로 보수적으로 둠.
  // 그러나 호환성을 위해 더 작은 값 (e.g. 1700)도 옵션.
  const DEFAULT_MAX_PAYLOAD_BYTES = 1800;

  function buildMigrationURIs(entries, opts = {}) {
    const maxBytes = opts.maxBytes || DEFAULT_MAX_PAYLOAD_BYTES;
    if (!entries || entries.length === 0) return [];

    const batchId = opts.batchId != null ? opts.batchId : (Math.floor(Math.random() * 2147483647));

    // 1) 미리 각 항목 인코딩 사이즈 계산
    const sized = entries.map((e) => {
      const otp = encodeOtpParameters(e);
      // tag + length-delim header 추가
      const overhead = encTag(1, 2).length + encVarint(otp.length).length;
      return { entry: e, bytes: otp.length + overhead };
    });

    // 2) 그리디 패킹
    const batches = [];
    let cur = [];
    let curSize = 0;
    // 메타 필드(version, batch_size, batch_index, batch_id) 약 16바이트 여유
    const META_RESERVE = 32;
    for (const item of sized) {
      if (item.bytes > (maxBytes - META_RESERVE)) {
        // 한 항목이 너무 크면 어쩔 수 없이 단독 배치
        if (cur.length > 0) { batches.push(cur); cur = []; curSize = 0; }
        batches.push([item.entry]);
        continue;
      }
      if (curSize + item.bytes > maxBytes - META_RESERVE) {
        batches.push(cur);
        cur = [];
        curSize = 0;
      }
      cur.push(item.entry);
      curSize += item.bytes;
    }
    if (cur.length > 0) batches.push(cur);

    // 3) 각 배치를 URI로 인코딩
    const total = batches.length;
    return batches.map((batchEntries, idx) => {
      const payload = encodeMigrationPayload(batchEntries, {
        batchId, batchSize: total, batchIndex: idx, version: 1
      });
      const b64 = bytesToB64(payload);
      const uri = 'otpauth-migration://offline?data=' + encodeURIComponent(b64);
      return { uri, index: idx, total, count: batchEntries.length };
    });
  }

  global.BoxOTPGauth = {
    encodeOtpParameters,
    encodeMigrationPayload,
    decodeMigrationPayload,
    buildMigrationURIs,
    base32Decode,
    base32Encode,
    bytesToB64
  };
})(typeof window !== 'undefined' ? window : globalThis);

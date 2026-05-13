// TOTP (RFC 6238) / HOTP (RFC 4226) 구현
// Web Crypto API 기반, 외부 라이브러리 의존성 없음.

(function (global) {
  'use strict';

  // ---------------- Base32 (RFC 4648) ----------------
  const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  function base32Decode(input) {
    if (!input) throw new Error('빈 시크릿 키');
    // 공백, 하이픈 제거 후 대문자로
    const clean = input.replace(/\s+/g, '').replace(/-/g, '').replace(/=+$/g, '').toUpperCase();
    if (!/^[A-Z2-7]+$/.test(clean)) {
      throw new Error('유효하지 않은 Base32 문자가 포함되어 있습니다');
    }

    let bits = 0;
    let value = 0;
    const output = [];

    for (let i = 0; i < clean.length; i++) {
      const idx = BASE32_ALPHABET.indexOf(clean[i]);
      if (idx === -1) throw new Error('Base32 디코딩 실패');
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        output.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(output);
  }

  // ---------------- TOTP 코드 생성 ----------------
  async function generateHOTP(secretBytes, counter, digits = 6, algorithm = 'SHA-1') {
    // counter를 8바이트 빅엔디안 버퍼로
    const counterBuf = new ArrayBuffer(8);
    const view = new DataView(counterBuf);
    // JS 비트 연산은 32비트라 high/low 분리
    const high = Math.floor(counter / 0x100000000);
    const low = counter >>> 0;
    view.setUint32(0, high);
    view.setUint32(4, low);

    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: { name: algorithm } },
      false,
      ['sign']
    );
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBuf));
    const offset = sig[sig.length - 1] & 0x0f;
    const binCode =
      ((sig[offset] & 0x7f) << 24) |
      ((sig[offset + 1] & 0xff) << 16) |
      ((sig[offset + 2] & 0xff) << 8) |
      (sig[offset + 3] & 0xff);
    const mod = Math.pow(10, digits);
    const code = (binCode % mod).toString().padStart(digits, '0');
    return code;
  }

  async function generateTOTP(secretBase32, options = {}) {
    const period = options.period || 30;
    const digits = options.digits || 6;
    const algorithm = (options.algorithm || 'SHA1').toUpperCase().replace('SHA', 'SHA-');
    const t = Math.floor((Date.now() / 1000) / period);
    const secretBytes = base32Decode(secretBase32);
    return generateHOTP(secretBytes, t, digits, algorithm);
  }

  function getRemainingSeconds(period = 30) {
    return period - (Math.floor(Date.now() / 1000) % period);
  }

  // ---------------- otpauth:// URI 파서 ----------------
  // 예: otpauth://totp/Issuer:account@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Issuer&digits=6&period=30&algorithm=SHA1
  function parseOtpauthURI(uri) {
    if (!uri || typeof uri !== 'string') throw new Error('URI가 비어있습니다');
    if (!uri.toLowerCase().startsWith('otpauth://')) {
      throw new Error('otpauth:// 로 시작하는 URI가 아닙니다');
    }

    // URL 파싱
    let parsed;
    try {
      parsed = new URL(uri);
    } catch (e) {
      throw new Error('URI 파싱 실패');
    }

    const type = parsed.hostname.toLowerCase(); // totp / hotp
    if (type !== 'totp' && type !== 'hotp') {
      throw new Error('지원되지 않는 타입: ' + type);
    }

    // pathname: "/Issuer:account" 또는 "/account"
    const label = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    let issuer = '';
    let account = label;
    if (label.includes(':')) {
      const [iss, acc] = label.split(':');
      issuer = iss.trim();
      account = acc.trim();
    }

    const params = parsed.searchParams;
    const secret = (params.get('secret') || '').replace(/\s+/g, '').toUpperCase();
    if (!secret) throw new Error('secret 파라미터가 없습니다');

    if (params.get('issuer')) issuer = params.get('issuer');

    return {
      type,
      label: account,
      issuer: issuer || '',
      secret,
      algorithm: (params.get('algorithm') || 'SHA1').toUpperCase(),
      digits: parseInt(params.get('digits') || '6', 10),
      period: parseInt(params.get('period') || '30', 10)
    };
  }

  // 시크릿 키 유효성 검사 (Base32 + 디코딩 시도)
  function validateSecret(secret) {
    try {
      const bytes = base32Decode(secret);
      if (bytes.length < 10) {
        // RFC 권장: 최소 128bit. 너무 짧으면 경고하되 허용.
        return { ok: true, warn: '시크릿 길이가 짧습니다 (권장: 16자 이상)' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  global.BoxOTP = {
    base32Decode,
    generateTOTP,
    getRemainingSeconds,
    parseOtpauthURI,
    validateSecret
  };
})(typeof window !== 'undefined' ? window : globalThis);

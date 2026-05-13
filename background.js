// BoxOTP background service worker
// 역할:
//  1. 팝업의 "화면 캡처" 요청을 받아 활성 탭에 오버레이 콘텐츠 스크립트 주입
//  2. 콘텐츠 스크립트로부터 드래그한 사각형 좌표를 받음
//  3. 활성 탭 캡처 → OffscreenCanvas로 크롭 → jsQR로 디코딩
//  4. 결과를 chrome.storage.session 에 저장 (팝업 재오픈 시 자동 채움)

importScripts('jsqr.js');

const PENDING_KEY = 'pending_capture';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'start-capture') {
    startCapture().then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
  if (msg && msg.action === 'capture-rect' && sender.tab) {
    handleRect(sender.tab.id, msg.rect, msg.dpr)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

async function startCapture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return { ok: false, error: '활성 탭 없음' };
  if (!tab.url || !/^https?:/i.test(tab.url)) {
    return { ok: false, error: '이 페이지에서는 캡처할 수 없습니다 (http/https만 지원)' };
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['capture-overlay.js']
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: '스크립트 주입 실패: ' + e.message };
  }
}

async function handleRect(tabId, rect, dpr) {
  if (!rect || rect.w < 20 || rect.h < 20) {
    return { ok: false, error: '선택 영역이 너무 작습니다' };
  }
  // 활성 탭의 윈도우에서 스크린샷
  let dataUrl;
  try {
    const tab = await chrome.tabs.get(tabId);
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (e) {
    return { ok: false, error: '캡처 실패: ' + e.message };
  }

  let bitmap;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    bitmap = await createImageBitmap(blob);
  } catch (e) {
    return { ok: false, error: '이미지 디코딩 실패: ' + e.message };
  }

  // rect 는 CSS 픽셀. 캡처 이미지는 device 픽셀(= css * dpr) 일 수 있음.
  // bitmap.width 와 window.innerWidth 비율로 실제 스케일을 추정.
  const scale = dpr || 1;
  const sx = Math.max(0, Math.floor(rect.x * scale));
  const sy = Math.max(0, Math.floor(rect.y * scale));
  let sw = Math.floor(rect.w * scale);
  let sh = Math.floor(rect.h * scale);
  if (sx + sw > bitmap.width)  sw = bitmap.width - sx;
  if (sy + sh > bitmap.height) sh = bitmap.height - sy;
  if (sw <= 0 || sh <= 0) {
    return { ok: false, error: '영역이 화면 밖' };
  }

  // 크롭한 영역에서 QR 디코드. 작은 영역이면 업스케일해서 정확도 향상.
  const upscale = Math.min(3, Math.max(1, Math.floor(400 / Math.min(sw, sh))));
  const tw = sw * upscale;
  const th = sh * upscale;
  const canvas = new OffscreenCanvas(tw, th);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, tw, th);
  const imageData = ctx.getImageData(0, 0, tw, th);

  const qr = self.jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth'
  });
  if (!qr || !qr.data) {
    return { ok: false, error: 'QR 코드를 찾지 못했습니다' };
  }
  if (!qr.data.toLowerCase().startsWith('otpauth://')) {
    return { ok: false, error: 'OTP QR이 아닙니다 (' + qr.data.substring(0, 40) + '…)' };
  }

  // 저장 (팝업이 다시 열릴 때 자동으로 채워짐)
  try {
    await chrome.storage.session.set({ [PENDING_KEY]: qr.data });
  } catch (e) {
    // session 미사용 시 local로 폴백
    await chrome.storage.local.set({ [PENDING_KEY]: qr.data });
  }
  return { ok: true, uri: qr.data };
}

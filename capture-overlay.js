// BoxOTP 캡처 오버레이
// 활성 탭에 주입되어 사용자가 QR 영역을 드래그로 선택할 수 있게 함.
// 드래그 완료 시 좌표를 background로 보내고 결과 토스트 표시.

(function () {
  if (window.__boxotp_capture_active) {
    // 이미 활성화: 무시
    return;
  }
  window.__boxotp_capture_active = true;

  const Z = 2147483646;
  const ACCENT = '#5eead4';

  // 어둡게 깔리는 마스크 (SVG로 안쪽 구멍을 동적으로 뚫음)
  const mask = document.createElement('div');
  mask.style.cssText = `
    position: fixed; inset: 0; z-index: ${Z};
    background: rgba(0, 0, 0, 0.45);
    cursor: crosshair; user-select: none;
  `;

  // 선택 영역(밝게 보임 + 테두리)
  const sel = document.createElement('div');
  sel.style.cssText = `
    position: fixed; z-index: ${Z + 1};
    border: 2px solid ${ACCENT};
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.45);
    background: transparent;
    pointer-events: none;
    display: none;
  `;

  // 힌트 배지
  const hint = document.createElement('div');
  hint.textContent = 'QR 코드 영역을 드래그하세요 · ESC 취소';
  hint.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    z-index: ${Z + 2};
    background: rgba(15, 17, 21, 0.92); color: ${ACCENT};
    padding: 10px 18px; border-radius: 999px;
    font: 600 13px -apple-system, BlinkMacSystemFont, "Noto Sans KR", sans-serif;
    border: 1px solid rgba(94, 234, 212, 0.4);
    pointer-events: none;
    letter-spacing: 0.2px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  `;

  // 크기 표시 (드래그 중)
  const size = document.createElement('div');
  size.style.cssText = `
    position: fixed; z-index: ${Z + 2};
    background: rgba(15, 17, 21, 0.92); color: ${ACCENT};
    padding: 4px 8px; border-radius: 4px;
    font: 600 11px -apple-system, monospace;
    pointer-events: none; display: none;
  `;

  document.documentElement.appendChild(mask);
  document.documentElement.appendChild(sel);
  document.documentElement.appendChild(hint);
  document.documentElement.appendChild(size);

  let startX = 0, startY = 0;
  let dragging = false;
  let rect = null;

  function cleanup() {
    mask.remove();
    sel.remove();
    hint.remove();
    size.remove();
    delete window.__boxotp_capture_active;
    document.removeEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      showToast('취소됨', false);
    }
  }

  function showToast(message, success) {
    const t = document.createElement('div');
    t.textContent = message;
    t.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      z-index: ${Z + 3};
      background: ${success ? '#0f1115' : '#1a0e0e'};
      color: ${success ? ACCENT : '#f87171'};
      border: 1px solid ${success ? 'rgba(94,234,212,0.5)' : 'rgba(248,113,113,0.5)'};
      padding: 12px 22px; border-radius: 12px;
      font: 600 13px -apple-system, BlinkMacSystemFont, "Noto Sans KR", sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      pointer-events: none;
      max-width: 80%;
      text-align: center;
    `;
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function updateRect(x1, y1, x2, y2) {
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    sel.style.left = x + 'px';
    sel.style.top = y + 'px';
    sel.style.width = w + 'px';
    sel.style.height = h + 'px';
    sel.style.display = 'block';
    rect = { x, y, w, h };
    // size 라벨
    size.style.left = (x + w + 6) + 'px';
    size.style.top = (y + h + 6) + 'px';
    size.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    size.style.display = 'block';
  }

  mask.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    updateRect(startX, startY, startX, startY);
  });

  // 드래그 중인 포인터가 selection 위로 가도 추적되도록 mask에서 mousemove 듣기
  mask.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    updateRect(startX, startY, e.clientX, e.clientY);
  });

  mask.addEventListener('mouseup', async (e) => {
    if (!dragging) return;
    dragging = false;
    updateRect(startX, startY, e.clientX, e.clientY);
    if (!rect || rect.w < 20 || rect.h < 20) {
      cleanup();
      showToast('영역이 너무 작습니다', false);
      return;
    }

    // 오버레이 모두 숨기고 페인트 대기 → 그 다음에 캡처
    const captureRect = { ...rect };
    const dpr = window.devicePixelRatio || 1;
    mask.style.display = 'none';
    sel.style.display = 'none';
    hint.style.display = 'none';
    size.style.display = 'none';

    // 두 RAF + 짧은 timeout 으로 페인트 확실히 대기
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 80));

    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'capture-rect',
        rect: captureRect,
        dpr
      });
      cleanup();
      if (resp && resp.ok) {
        showToast('✓ QR 인식 완료 — BoxOTP를 다시 열어주세요', true);
      } else {
        showToast('인식 실패: ' + ((resp && resp.error) || '알 수 없는 오류'), false);
      }
    } catch (err) {
      cleanup();
      showToast('오류: ' + err.message, false);
    }
  });

  document.addEventListener('keydown', onKey, true);
})();

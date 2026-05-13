// BoxOTP - 메인 UI 로직
// 의존성: totp.js (window.BoxOTP), jsqr.js (window.jsQR)
// chrome.storage.local 에 OTP 목록 저장

(function () {
  'use strict';

  const STORAGE_KEY = 'otp_entries';
  const VIEW_KEY = 'view_mode';     // 'tile' | 'detail'
  const THEME_KEY = 'theme_mode';   // 'dark' | 'light' | 'sepia' | 'midnight'
  const VALID_THEMES = ['dark', 'light', 'sepia', 'midnight'];
  const DEFAULT_THEME = 'dark';
  const SCHEMA_VERSION = 1;

  // ----- DOM 핸들 -----
  const $ = (id) => document.getElementById(id);
  const listEl       = $('otpList');
  const emptyEl      = $('emptyState');
  const addBtn       = $('addBtn');
  const searchBtn    = $('searchBtn');
  const searchBar    = $('searchBar');
  const searchInput  = $('searchInput');
  const menuBtn      = $('menuBtn');
  const menuDropdown = $('menuDropdown');
  const formModal    = $('formModal');
  const formTitle    = $('formTitle');
  const closeFormBtn = $('closeFormBtn');
  const cancelFormBtn= $('cancelFormBtn');
  const saveFormBtn  = $('saveFormBtn');
  const formError    = $('formError');
  const fLabel       = $('f-label');
  const fIssuer      = $('f-issuer');
  const fSecret      = $('f-secret');
  const fDigits      = $('f-digits');
  const fPeriod      = $('f-period');
  const fAlgorithm   = $('f-algorithm');
  const fUri         = $('f-uri');
  const fQrFile      = $('f-qr-file');
  const qrDropArea   = $('qrDropArea');
  const qrPreview    = $('qrPreview');
  const qrStatus     = $('qrStatus');
  const importFile   = $('importFile');
  const importTxtFile= $('importTxtFile');
  const gauthModal   = $('gauthModal');
  const gauthInfo    = $('gauthInfo');
  const gauthQrWrap  = $('gauthQrWrap');
  const gauthPrevBtn = $('gauthPrevBtn');
  const gauthNextBtn = $('gauthNextBtn');
  const gauthPageLabel = $('gauthPageLabel');
  const gauthUriText = $('gauthUriText');
  const gauthCopyUriBtn = $('gauthCopyUriBtn');
  const closeGauthBtn= $('closeGauthBtn');
  const viewToggleBtn= $('viewToggleBtn');
  const renameModal  = $('renameModal');
  const renameLabel  = $('renameLabel');
  const renameIssuer = $('renameIssuer');
  const renameError  = $('renameError');
  const confirmRenameBtn = $('confirmRenameBtn');
  const cancelRenameBtn  = $('cancelRenameBtn');
  const closeRenameBtn   = $('closeRenameBtn');
  const tileMenu     = $('tileMenu');
  const captureScreenBtn = $('captureScreenBtn');
  const qrScanBtn    = $('qrScanBtn');
  const toastEl      = $('toast');
  const pwModal      = $('pwModal');
  const pwTitle      = $('pwTitle');
  const pwLabel      = $('pwLabel');
  const pwInput      = $('pwInput');
  const pwError      = $('pwError');
  const confirmPwBtn = $('confirmPwBtn');
  const cancelPwBtn  = $('cancelPwBtn');
  const closePwBtn   = $('closePwBtn');
  const confirmModal = $('confirmModal');
  const confirmTitle = $('confirmTitle');
  const confirmMsg   = $('confirmMessage');
  const okConfirmBtn = $('okConfirmBtn');
  const cancelConfirmBtn = $('cancelConfirmBtn');

  // ----- 상태 -----
  let entries = [];
  let editingId = null;        // 수정 중인 entry id (null이면 신규 추가)
  let activeTab = 'manual';
  let pendingQrUri = null;     // QR 인식으로 얻은 URI
  let searchQuery = '';
  let timerInterval = null;
  let gauthPages = [];     // [{ uri, index, total, count }]
  let gauthCurrentPage = 0;
  let viewMode = 'tile';   // 'tile' | 'detail'
  let theme = DEFAULT_THEME;
  let dragSourceId = null; // 드래그 중인 entry id
  let renameTargetId = null;
  let tileMenuTargetId = null;

  // ----- 스토리지 -----
  function storageGet(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (data) => resolve(data[key]));
    });
  }
  function storageSet(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }

  async function loadEntries() {
    const data = await storageGet(STORAGE_KEY);
    entries = Array.isArray(data) ? data : [];
  }
  async function saveEntries() {
    await storageSet(STORAGE_KEY, entries);
  }
  async function loadViewMode() {
    const v = await storageGet(VIEW_KEY);
    viewMode = (v === 'detail' || v === 'tile') ? v : 'tile';
  }
  async function saveViewMode() {
    await storageSet(VIEW_KEY, viewMode);
  }

  // ----- 테마 -----
  async function loadTheme() {
    const v = await storageGet(THEME_KEY);
    theme = VALID_THEMES.includes(v) ? v : DEFAULT_THEME;
  }
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', theme);
    // 메뉴의 활성 표시 갱신
    document.querySelectorAll('.theme-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.action === 'theme-' + theme);
    });
  }
  async function setTheme(name) {
    if (!VALID_THEMES.includes(name)) return;
    theme = name;
    await storageSet(THEME_KEY, theme);
    applyTheme();
  }

  // ----- 유틸 -----
  function uid() {
    return 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function showToast(message, type = '') {
    toastEl.textContent = message;
    toastEl.className = 'toast ' + type;
    toastEl.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 1800);
  }

  function showError(el, message) {
    el.textContent = message;
    el.classList.remove('hidden');
  }
  function clearError(el) {
    el.textContent = '';
    el.classList.add('hidden');
  }

  // ----- 렌더링 -----
  function render() {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? entries.filter((e) =>
          (e.label || '').toLowerCase().includes(q) ||
          (e.issuer || '').toLowerCase().includes(q))
      : entries;

    listEl.innerHTML = '';
    listEl.classList.toggle('view-tile', viewMode === 'tile');

    // 뷰 토글 버튼 라벨 갱신
    if (viewToggleBtn) {
      viewToggleBtn.textContent = viewMode === 'tile' ? '☰' : '⊞';
      viewToggleBtn.title = viewMode === 'tile' ? '상세 보기' : '타일 보기';
    }

    if (entries.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }
    emptyEl.classList.add('hidden');

    if (filtered.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'empty-state';
      noResults.style.padding = '30px';
      noResults.innerHTML = '<p class="empty-sub">검색 결과가 없습니다</p>';
      listEl.appendChild(noResults);
      return;
    }

    for (const entry of filtered) {
      if (viewMode === 'tile') {
        listEl.appendChild(createTile(entry));
      } else {
        listEl.appendChild(createCard(entry));
      }
    }
    // 코드 갱신 (상세 모드에서만 표시되지만 진행바를 위해 둘 다 호출)
    if (viewMode === 'detail') refreshCodes();
    updateTimers();
  }

  function createCard(entry) {
    const card = document.createElement('div');
    card.className = 'otp-card';
    card.dataset.id = entry.id;
    card.draggable = true;

    card.innerHTML = `
      <div class="otp-card-top">
        <div class="otp-meta">
          ${entry.issuer ? `<div class="otp-issuer">${escapeHtml(entry.issuer)}</div>` : ''}
          <div class="otp-label"><span class="drag-handle" title="끌어서 정렬">⋮⋮</span>${escapeHtml(entry.label || '(이름 없음)')}</div>
        </div>
        <div class="otp-actions">
          <button class="icon-btn" data-act="edit" title="수정">✏️</button>
          <button class="icon-btn" data-act="delete" title="삭제">🗑️</button>
        </div>
      </div>
      <div class="otp-bottom">
        <div class="otp-code" data-code>------</div>
        <div class="otp-timer" data-timer>
          <svg viewBox="0 0 24 24">
            <circle class="timer-bg" cx="12" cy="12" r="10"></circle>
            <circle class="timer-fg" cx="12" cy="12" r="10"
              stroke-dasharray="62.8" stroke-dashoffset="0"></circle>
          </svg>
          <span class="timer-text">--</span>
        </div>
      </div>
    `;

    // 카드 클릭 (복사 + 자동 채우기)
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-act]') || e.target.classList.contains('drag-handle')) return;
      copyAndFill(entry, e);
    });

    // 수정/삭제 버튼
    card.querySelector('[data-act="edit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openForm(entry);
    });
    card.querySelector('[data-act="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDelete(entry);
    });

    attachDnD(card);
    return card;
  }

  function createTile(entry) {
    const tile = document.createElement('div');
    tile.className = 'otp-tile';
    tile.dataset.id = entry.id;
    tile.draggable = true;

    tile.innerHTML = `
      ${entry.issuer ? `<div class="tile-issuer">${escapeHtml(entry.issuer)}</div>` : ''}
      <div class="tile-label">${escapeHtml(entry.label || '(이름 없음)')}</div>
      <button class="tile-menu-btn" data-act="menu" title="메뉴">⋮</button>
      <div class="tile-progress" data-progress></div>
    `;

    tile.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="menu"]')) return;
      copyAndFill(entry, e);
    });

    // ⋮ 버튼
    tile.querySelector('[data-act="menu"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openTileMenu(entry, e.currentTarget);
    });

    // 우클릭 → 메뉴
    tile.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const btn = tile.querySelector('[data-act="menu"]');
      openTileMenu(entry, btn);
    });

    attachDnD(tile);
    return tile;
  }

  // ----- 드래그 앤 드롭 -----
  function attachDnD(el) {
    el.addEventListener('dragstart', (e) => {
      if (searchQuery) {
        // 검색 중에는 정렬 비활성 (필터된 인덱스가 어긋남)
        e.preventDefault();
        return;
      }
      dragSourceId = el.dataset.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', el.dataset.id); } catch (_) {}
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
      dragSourceId = null;
    });
    el.addEventListener('dragover', (e) => {
      if (!dragSourceId || dragSourceId === el.dataset.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const fromId = dragSourceId;
      const toId = el.dataset.id;
      if (!fromId || fromId === toId) return;
      const fromIdx = entries.findIndex((x) => x.id === fromId);
      const toIdx = entries.findIndex((x) => x.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = entries.splice(fromIdx, 1);
      entries.splice(toIdx, 0, moved);
      await saveEntries();
      render();
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ----- 코드/타이머 갱신 -----
  async function refreshCodes() {
    const cards = listEl.querySelectorAll('.otp-card');
    for (const card of cards) {
      const id = card.dataset.id;
      const entry = entries.find((e) => e.id === id);
      if (!entry) continue;
      try {
        const code = await BoxOTP.generateTOTP(entry.secret, {
          period: entry.period,
          digits: entry.digits,
          algorithm: entry.algorithm
        });
        // 가독성: 6자리는 3-3, 8자리는 4-4
        const codeEl = card.querySelector('[data-code]');
        if (code.length === 8) {
          codeEl.textContent = code.slice(0, 4) + ' ' + code.slice(4);
        } else if (code.length === 7) {
          codeEl.textContent = code.slice(0, 3) + ' ' + code.slice(3);
        } else {
          codeEl.textContent = code.slice(0, 3) + ' ' + code.slice(3);
        }
        codeEl.dataset.raw = code;
      } catch (e) {
        card.querySelector('[data-code]').textContent = '오류';
      }
    }
    updateTimers();
  }

  function updateTimers() {
    // 상세 카드
    const cards = listEl.querySelectorAll('.otp-card');
    for (const card of cards) {
      const id = card.dataset.id;
      const entry = entries.find((e) => e.id === id);
      if (!entry) continue;
      const remain = BoxOTP.getRemainingSeconds(entry.period);
      const total = entry.period;
      const timer = card.querySelector('[data-timer]');
      const fg = timer.querySelector('.timer-fg');
      const txt = timer.querySelector('.timer-text');
      const circumference = 62.8;
      const offset = circumference * (1 - remain / total);
      fg.setAttribute('stroke-dashoffset', offset.toFixed(2));
      txt.textContent = remain;
      timer.classList.toggle('warn', remain <= 10 && remain > 5);
      timer.classList.toggle('danger', remain <= 5);
    }

    // 타일 progress bar
    const tiles = listEl.querySelectorAll('.otp-tile');
    for (const tile of tiles) {
      const id = tile.dataset.id;
      const entry = entries.find((e) => e.id === id);
      if (!entry) continue;
      const remain = BoxOTP.getRemainingSeconds(entry.period);
      const total = entry.period;
      const bar = tile.querySelector('[data-progress]');
      bar.style.transform = `scaleX(${remain / total})`;
      bar.classList.toggle('warn', remain <= 10 && remain > 5);
      bar.classList.toggle('danger', remain <= 5);
    }
  }

  function startTimerLoop() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      let needCodeRefresh = false;
      // 상세 모드 카드의 코드 bucket 추적
      for (const card of listEl.querySelectorAll('.otp-card')) {
        const entry = entries.find((e) => e.id === card.dataset.id);
        if (!entry) continue;
        const bucket = Math.floor(now / entry.period);
        const prev = parseInt(card.dataset.bucket || '0', 10);
        if (bucket !== prev) {
          card.dataset.bucket = bucket;
          needCodeRefresh = true;
        }
      }
      if (needCodeRefresh) refreshCodes();
      else updateTimers();
    }, 1000);
  }

  // ----- 클립보드 복사 + 자동 채우기 -----
  async function copyAndFill(entry) {
    let code;
    try {
      code = await BoxOTP.generateTOTP(entry.secret, {
        period: entry.period,
        digits: entry.digits,
        algorithm: entry.algorithm
      });
    } catch (e) {
      showToast('생성 실패: ' + e.message, 'error');
      return;
    }

    // 1) 클립보드 복사
    let copied = false;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch (e) {
      console.warn('clipboard 실패', e);
    }

    // 2) 자동 채우기 시도 (활성 탭)
    let filled = false;
    try {
      filled = await tryAutofill(code);
    } catch (e) {
      console.warn('autofill 실패', e);
    }

    const name = entry.issuer ? `${entry.issuer} · ${entry.label}` : entry.label;
    let msg = '';
    if (filled && copied) msg = `${name} 채움 + 복사됨`;
    else if (filled)      msg = `${name} 채움`;
    else if (copied)      msg = `${name} 복사됨`;
    else                  msg = `${name} 실패`;
    showToast(msg, (filled || copied) ? 'success' : 'error');
  }

  async function tryAutofill(code) {
    if (!chrome.scripting || !chrome.tabs) return false;
    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (_) { return false; }
    if (!tab || !tab.id) return false;
    // chrome://, edge://, about:, chrome-extension:// 등은 주입 불가
    if (!tab.url || /^(chrome|edge|about|chrome-extension|chrome-untrusted|moz-extension|view-source):/i.test(tab.url)) {
      return false;
    }
    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: autofillInPage,
        args: [code]
      });
    } catch (e) {
      console.warn('executeScript 실패:', e);
      return false;
    }
    return results.some((r) => r && r.result && r.result.filled);
  }

  // 이 함수는 페이지 컨텍스트에 주입됨 — 외부 스코프 캡처 불가
  function autofillInPage(code) {
    function isVisible(el) {
      if (!el || el.disabled || el.readOnly) return false;
      if (el.offsetParent === null) {
        const style = window.getComputedStyle(el);
        if (style.position !== 'fixed') return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    function setValue(el, val) {
      try {
        const proto = el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, val);
      } catch (_) {
        el.value = val;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 1순위: 분할 입력란 (maxlength=1 input들이 연속) — autocomplete=one-time-code 우선
    function findSplitInputs() {
      const candidates = Array.from(document.querySelectorAll(
        'input[autocomplete="one-time-code"], input[maxlength="1"][type="text"], input[maxlength="1"][type="tel"], input[maxlength="1"][type="number"], input[maxlength="1"][inputmode="numeric"], input[maxlength="1"][inputmode="tel"]'
      )).filter(isVisible);
      // 같은 부모 또는 인접한 형제 그룹 찾기
      // 간단히: 모두 maxlength=1이고 개수 >= code.length이면 분할 입력으로 간주
      const singles = candidates.filter((c) => c.maxLength === 1);
      if (singles.length >= code.length) {
        return singles.slice(0, code.length);
      }
      return null;
    }

    // 2순위: 단일 OTP 입력란
    function findSingleInput() {
      const sels = [
        'input[autocomplete="one-time-code"]:not([disabled]):not([readonly])',
        'input[name*="otp" i]',
        'input[id*="otp" i]',
        'input[name*="2fa" i]',
        'input[id*="2fa" i]',
        'input[name*="totp" i]',
        'input[id*="totp" i]',
        'input[name*="mfa" i]',
        'input[id*="mfa" i]',
        'input[aria-label*="OTP" i]',
        'input[aria-label*="인증" i]',
        'input[aria-label*="보안코드" i]',
        'input[placeholder*="OTP" i]',
        'input[placeholder*="인증번호" i]',
        'input[name*="verif" i]',
        'input[name*="auth_code" i]',
        'input[name*="security_code" i]',
        'input[inputmode="numeric"][maxlength="6"]',
        'input[inputmode="numeric"][maxlength="7"]',
        'input[inputmode="numeric"][maxlength="8"]',
        'input[type="tel"][maxlength="6"]',
        'input[type="tel"][maxlength="7"]',
        'input[type="tel"][maxlength="8"]'
      ];
      // 포커스된 입력 우선
      const active = document.activeElement;
      if (active && active.tagName === 'INPUT' && isVisible(active)) {
        const t = (active.type || '').toLowerCase();
        if (['text', 'tel', 'number', 'password', ''].includes(t)) {
          return active;
        }
      }
      for (const sel of sels) {
        try {
          const els = Array.from(document.querySelectorAll(sel)).filter(isVisible);
          if (els.length > 0) return els[0];
        } catch (_) { /* 잘못된 셀렉터 무시 */ }
      }
      return null;
    }

    const split = findSplitInputs();
    if (split) {
      for (let i = 0; i < code.length; i++) {
        setValue(split[i], code[i]);
      }
      split[split.length - 1].focus();
      return { filled: true, mode: 'split' };
    }
    const single = findSingleInput();
    if (single) {
      setValue(single, code);
      single.focus();
      return { filled: true, mode: 'single' };
    }
    return { filled: false };
  }

  // ----- 폼 모달 -----
  function openForm(entry = null) {
    editingId = entry ? entry.id : null;
    formTitle.textContent = entry ? 'OTP 수정' : 'OTP 추가';

    // 초기화
    fLabel.value = entry ? entry.label || '' : '';
    fIssuer.value = entry ? entry.issuer || '' : '';
    fSecret.value = entry ? entry.secret || '' : '';
    fDigits.value = entry ? (entry.digits || 6) : 6;
    fPeriod.value = entry ? (entry.period || 30) : 30;
    fAlgorithm.value = entry ? (entry.algorithm || 'SHA1') : 'SHA1';
    fUri.value = '';
    pendingQrUri = null;
    qrPreview.classList.add('hidden');
    qrStatus.textContent = '';
    qrStatus.className = 'qr-status';
    clearError(formError);

    // 수정 모드면 직접 입력 탭으로
    setTab('manual');
    // 수정 시 URI/QR 탭은 숨김
    document.querySelectorAll('.tab').forEach((t) => {
      if (entry && (t.dataset.tab === 'uri' || t.dataset.tab === 'qr')) {
        t.style.display = 'none';
      } else {
        t.style.display = '';
      }
    });

    formModal.classList.remove('hidden');
    setTimeout(() => fLabel.focus(), 100);
  }

  function closeForm() {
    formModal.classList.add('hidden');
    editingId = null;
  }

  function setTab(name) {
    activeTab = name;
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('hidden', p.id !== 'tab-' + name);
    });
  }

  async function handleSave() {
    clearError(formError);
    let entry;

    try {
      if (editingId) {
        // 수정 모드: 직접 입력만
        entry = parseManualForm();
        const idx = entries.findIndex((e) => e.id === editingId);
        if (idx === -1) throw new Error('수정 대상을 찾을 수 없습니다');
        entry.id = editingId;
        // 검증
        const v = BoxOTP.validateSecret(entry.secret);
        if (!v.ok) throw new Error('시크릿 키 오류: ' + v.error);
        entries[idx] = entry;
      } else {
        // 추가 모드
        if (activeTab === 'manual') {
          entry = parseManualForm();
        } else if (activeTab === 'uri') {
          entry = parseUriForm();
        } else if (activeTab === 'qr') {
          if (!pendingQrUri) throw new Error('QR 코드를 먼저 인식하세요');
          entry = parseFromUri(pendingQrUri);
        }
        const v = BoxOTP.validateSecret(entry.secret);
        if (!v.ok) throw new Error('시크릿 키 오류: ' + v.error);
        entry.id = uid();
        entry.createdAt = Date.now();
        entries.push(entry);
      }
      await saveEntries();
      closeForm();
      render();
      showToast(editingId ? '수정됨' : '추가됨', 'success');
    } catch (e) {
      showError(formError, e.message);
    }
  }

  function parseManualForm() {
    const secret = fSecret.value.trim();
    if (!secret) throw new Error('시크릿 키를 입력하세요');
    const label = fLabel.value.trim();
    if (!label) throw new Error('이름을 입력하세요');
    return {
      label,
      issuer: fIssuer.value.trim(),
      secret: secret.replace(/\s+/g, '').toUpperCase(),
      digits: parseInt(fDigits.value, 10),
      period: parseInt(fPeriod.value, 10),
      algorithm: fAlgorithm.value
    };
  }

  function parseUriForm() {
    const uri = fUri.value.trim();
    if (!uri) throw new Error('URI를 입력하세요');
    return parseFromUri(uri);
  }

  function parseFromUri(uri) {
    const p = BoxOTP.parseOtpauthURI(uri);
    if (p.type !== 'totp') throw new Error('TOTP 타입만 지원됩니다');
    return {
      label: p.label,
      issuer: p.issuer,
      secret: p.secret,
      digits: p.digits || 6,
      period: p.period || 30,
      algorithm: p.algorithm || 'SHA1'
    };
  }

  // ----- 삭제 -----
  function confirmDelete(entry) {
    confirmTitle.textContent = '삭제 확인';
    const name = entry.issuer ? `${entry.issuer} (${entry.label})` : entry.label;
    confirmMsg.textContent = `"${name}" 항목을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`;
    confirmModal.classList.remove('hidden');

    const onOk = async () => {
      entries = entries.filter((e) => e.id !== entry.id);
      await saveEntries();
      confirmModal.classList.add('hidden');
      render();
      showToast('삭제됨', 'success');
      cleanup();
    };
    const onCancel = () => {
      confirmModal.classList.add('hidden');
      cleanup();
    };
    const cleanup = () => {
      okConfirmBtn.removeEventListener('click', onOk);
      cancelConfirmBtn.removeEventListener('click', onCancel);
    };
    okConfirmBtn.addEventListener('click', onOk);
    cancelConfirmBtn.addEventListener('click', onCancel);
  }

  function confirmDeleteAll() {
    if (entries.length === 0) {
      showToast('삭제할 항목이 없습니다');
      return;
    }
    confirmTitle.textContent = '전체 삭제';
    confirmMsg.textContent = `등록된 모든 OTP (${entries.length}개)를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`;
    confirmModal.classList.remove('hidden');

    const onOk = async () => {
      entries = [];
      await saveEntries();
      confirmModal.classList.add('hidden');
      render();
      showToast('모두 삭제됨', 'success');
      cleanup();
    };
    const onCancel = () => {
      confirmModal.classList.add('hidden');
      cleanup();
    };
    const cleanup = () => {
      okConfirmBtn.removeEventListener('click', onOk);
      cancelConfirmBtn.removeEventListener('click', onCancel);
    };
    okConfirmBtn.addEventListener('click', onOk);
    cancelConfirmBtn.addEventListener('click', onCancel);
  }

  // ----- QR 이미지 인식 -----
  async function handleQrFile(file) {
    qrStatus.textContent = '인식 중…';
    qrStatus.className = 'qr-status';
    try {
      const dataUrl = await readFileAsDataURL(file);
      const img = await loadImage(dataUrl);
      const canvas = qrPreview;
      const ctx = canvas.getContext('2d');
      // 큰 이미지는 줄여서 처리
      const maxSize = 600;
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      canvas.width = Math.floor(img.width * scale);
      canvas.height = Math.floor(img.height * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.classList.remove('hidden');

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = window.jsQR(imageData.data, imageData.width, imageData.height);
      if (!result || !result.data) {
        qrStatus.textContent = 'QR 코드를 찾지 못했습니다';
        qrStatus.className = 'qr-status error';
        pendingQrUri = null;
        return;
      }
      // otpauth:// 확인
      if (!result.data.toLowerCase().startsWith('otpauth://')) {
        qrStatus.textContent = 'OTP QR 코드가 아닙니다';
        qrStatus.className = 'qr-status error';
        pendingQrUri = null;
        return;
      }
      // 파싱 검증
      try {
        const parsed = BoxOTP.parseOtpauthURI(result.data);
        pendingQrUri = result.data;
        qrStatus.textContent = `✓ ${parsed.issuer ? parsed.issuer + ' / ' : ''}${parsed.label}`;
        qrStatus.className = 'qr-status success';
      } catch (e) {
        qrStatus.textContent = '인식 실패: ' + e.message;
        qrStatus.className = 'qr-status error';
        pendingQrUri = null;
      }
    } catch (e) {
      qrStatus.textContent = '오류: ' + e.message;
      qrStatus.className = 'qr-status error';
      pendingQrUri = null;
    }
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('파일 읽기 실패'));
      r.readAsDataURL(file);
    });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = src;
    });
  }

  // ----- 백업 / 복원 -----
  async function exportPlain() {
    if (entries.length === 0) {
      showToast('내보낼 항목이 없습니다');
      return;
    }
    const payload = {
      app: 'BoxOTP',
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      encrypted: false,
      entries
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `boxotp-backup-${dateStamp()}.json`);
    showToast('백업 파일 생성됨', 'success');
  }

  async function exportEncrypted() {
    if (entries.length === 0) {
      showToast('내보낼 항목이 없습니다');
      return;
    }
    const pw = await askPassword({
      title: '백업 암호화',
      label: '새 비밀번호 (분실 시 복원 불가)'
    });
    if (!pw) return;
    if (pw.length < 4) {
      showToast('비밀번호는 4자 이상', 'error');
      return;
    }
    try {
      const plaintext = new TextEncoder().encode(JSON.stringify({ entries }));
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await deriveKey(pw, salt);
      const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
      );
      const payload = {
        app: 'BoxOTP',
        version: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        encrypted: true,
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 200000, salt: bytesToB64(salt) },
        cipher: { name: 'AES-GCM', iv: bytesToB64(iv) },
        data: bytesToB64(ct)
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      triggerDownload(blob, `boxotp-backup-encrypted-${dateStamp()}.json`);
      showToast('암호화 백업 생성됨', 'success');
    } catch (e) {
      showToast('암호화 실패: ' + e.message, 'error');
    }
  }

  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function dateStamp() {
    const d = new Date();
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
  }

  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const s = atob(b64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  async function deriveKey(password, salt) {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt', 'encrypt']
    );
  }

  async function handleImportFile(file) {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload || payload.app !== 'BoxOTP') {
        throw new Error('BoxOTP 백업 파일이 아닙니다');
      }
      let imported;
      if (payload.encrypted) {
        const pw = await askPassword({ title: '백업 복원', label: '백업 비밀번호' });
        if (!pw) return;
        try {
          const salt = b64ToBytes(payload.kdf.salt);
          const iv = b64ToBytes(payload.cipher.iv);
          const ct = b64ToBytes(payload.data);
          const key = await deriveKey(pw, salt);
          const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
          const obj = JSON.parse(new TextDecoder().decode(pt));
          imported = obj.entries || [];
        } catch (e) {
          showToast('복호화 실패: 비밀번호 확인', 'error');
          return;
        }
      } else {
        imported = payload.entries || [];
      }
      if (!Array.isArray(imported)) throw new Error('잘못된 백업 형식');

      // 병합: secret 기준으로 중복 제거
      const existingSecrets = new Set(entries.map((e) => e.secret));
      let added = 0;
      for (const e of imported) {
        if (!e.secret) continue;
        if (existingSecrets.has(e.secret)) continue;
        entries.push({
          id: e.id || uid(),
          label: e.label || '',
          issuer: e.issuer || '',
          secret: e.secret,
          digits: e.digits || 6,
          period: e.period || 30,
          algorithm: e.algorithm || 'SHA1',
          createdAt: e.createdAt || Date.now()
        });
        existingSecrets.add(e.secret);
        added++;
      }
      await saveEntries();
      render();
      showToast(`${added}개 항목 가져옴 (중복 ${imported.length - added}개 제외)`, 'success');
    } catch (e) {
      showToast('복원 실패: ' + e.message, 'error');
    } finally {
      importFile.value = '';
    }
  }

  // ----- TXT (otpauth URI 줄별) 가져오기 -----
  async function handleTxtImport(file) {
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/);
      const existingSecrets = new Set(entries.map((e) => e.secret));
      let added = 0;
      let skipped = 0;
      let errors = 0;
      const errLines = [];

      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;                   // 빈 줄 무시
        if (line.startsWith('#')) continue;    // 주석 무시
        if (!line.toLowerCase().startsWith('otpauth://')) {
          errors++;
          if (errLines.length < 3) errLines.push(`줄 ${i + 1}: otpauth:// 아님`);
          continue;
        }
        try {
          const p = BoxOTP.parseOtpauthURI(line);
          if (p.type !== 'totp') {
            errors++;
            if (errLines.length < 3) errLines.push(`줄 ${i + 1}: TOTP가 아님`);
            continue;
          }
          // 시크릿 유효성
          const v = BoxOTP.validateSecret(p.secret);
          if (!v.ok) {
            errors++;
            if (errLines.length < 3) errLines.push(`줄 ${i + 1}: ${v.error}`);
            continue;
          }
          if (existingSecrets.has(p.secret)) {
            skipped++;
            continue;
          }
          entries.push({
            id: uid(),
            label: p.label,
            issuer: p.issuer,
            secret: p.secret,
            digits: p.digits || 6,
            period: p.period || 30,
            algorithm: p.algorithm || 'SHA1',
            createdAt: Date.now()
          });
          existingSecrets.add(p.secret);
          added++;
        } catch (e) {
          errors++;
          if (errLines.length < 3) errLines.push(`줄 ${i + 1}: ${e.message}`);
        }
      }
      await saveEntries();
      render();
      let msg = `${added}개 추가`;
      if (skipped) msg += ` · 중복 ${skipped}`;
      if (errors)  msg += ` · 오류 ${errors}`;
      showToast(msg, errors > 0 && added === 0 ? 'error' : 'success');
      if (errors > 0) {
        console.warn('[BoxOTP] TXT import 오류:', errLines);
      }
    } catch (e) {
      showToast('TXT 읽기 실패: ' + e.message, 'error');
    } finally {
      importTxtFile.value = '';
    }
  }

  // ----- Google Auth QR 백업 -----
  function exportGoogleAuth() {
    if (entries.length === 0) {
      showToast('내보낼 항목이 없습니다');
      return;
    }
    try {
      gauthPages = BoxOTPGauth.buildMigrationURIs(entries);
      if (gauthPages.length === 0) {
        showToast('생성 실패', 'error');
        return;
      }
      gauthCurrentPage = 0;
      renderGauthPage();
      gauthModal.classList.remove('hidden');
    } catch (e) {
      showToast('Google OTP 백업 실패: ' + e.message, 'error');
    }
  }

  function renderGauthPage() {
    const page = gauthPages[gauthCurrentPage];
    if (!page) return;

    // 정보
    const totalItems = gauthPages.reduce((s, p) => s + p.count, 0);
    if (gauthPages.length === 1) {
      gauthInfo.textContent = `${totalItems}개 항목을 1개의 QR로 내보냅니다`;
    } else {
      gauthInfo.textContent = `${totalItems}개 항목을 ${gauthPages.length}개의 QR로 분할 — Google OTP에서 순서대로 스캔하세요`;
    }
    gauthPageLabel.textContent = `${gauthCurrentPage + 1} / ${gauthPages.length}`;

    // QR 생성
    gauthQrWrap.innerHTML = '';
    const qr = qrcode(0, 'M'); // type=auto, ECC=M
    qr.addData(page.uri, 'Byte');
    qr.make();
    // SVG가 깔끔하니 SVG로
    const moduleCount = qr.getModuleCount();
    const cellSize = 6;
    const margin = 4;
    const size = moduleCount * cellSize + margin * 2;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${Math.min(size, 240)}" height="${Math.min(size, 240)}" shape-rendering="crispEdges">`;
    svg += `<rect width="100%" height="100%" fill="#ffffff"/>`;
    let path = '';
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) {
          path += `M${margin + c * cellSize},${margin + r * cellSize}h${cellSize}v${cellSize}h-${cellSize}z`;
        }
      }
    }
    svg += `<path d="${path}" fill="#000000"/></svg>`;
    gauthQrWrap.innerHTML = svg;

    // URI 텍스트
    gauthUriText.value = page.uri;

    // 페이저
    gauthPrevBtn.disabled = gauthCurrentPage === 0;
    gauthNextBtn.disabled = gauthCurrentPage >= gauthPages.length - 1;
  }

  function closeGauth() {
    gauthModal.classList.add('hidden');
    gauthQrWrap.innerHTML = '';
    gauthPages = [];
  }

  // ----- 타일 컨텍스트 메뉴 (⋮) -----
  function openTileMenu(entry, anchorBtn) {
    tileMenuTargetId = entry.id;
    // 위치 계산
    const rect = anchorBtn.getBoundingClientRect();
    const containerRect = document.body.getBoundingClientRect();
    tileMenu.style.position = 'absolute';
    tileMenu.style.top = (rect.bottom - containerRect.top + 2) + 'px';
    // 화면 오른쪽 넘침 방지
    const menuWidth = 160;
    let left = rect.right - containerRect.left - menuWidth;
    if (left < 6) left = 6;
    tileMenu.style.left = left + 'px';
    tileMenu.style.right = 'auto';
    tileMenu.classList.remove('hidden');

    // 위/아래 가능 여부에 따라 비활성
    const idx = entries.findIndex((x) => x.id === entry.id);
    tileMenu.querySelector('[data-act="move-up"]').disabled = (idx <= 0);
    tileMenu.querySelector('[data-act="move-down"]').disabled = (idx >= entries.length - 1);
  }

  function closeTileMenu() {
    tileMenu.classList.add('hidden');
    tileMenuTargetId = null;
  }

  async function handleTileAction(act) {
    const entry = entries.find((e) => e.id === tileMenuTargetId);
    if (!entry) return;
    closeTileMenu();
    if (act === 'rename')      openRename(entry);
    else if (act === 'edit')   openForm(entry);
    else if (act === 'delete') confirmDelete(entry);
    else if (act === 'move-up') {
      const i = entries.findIndex((e) => e.id === entry.id);
      if (i > 0) {
        [entries[i - 1], entries[i]] = [entries[i], entries[i - 1]];
        await saveEntries();
        render();
      }
    } else if (act === 'move-down') {
      const i = entries.findIndex((e) => e.id === entry.id);
      if (i >= 0 && i < entries.length - 1) {
        [entries[i + 1], entries[i]] = [entries[i], entries[i + 1]];
        await saveEntries();
        render();
      }
    }
  }

  // ----- 빠른 이름 변경 -----
  function openRename(entry) {
    renameTargetId = entry.id;
    renameLabel.value = entry.label || '';
    renameIssuer.value = entry.issuer || '';
    clearError(renameError);
    renameModal.classList.remove('hidden');
    setTimeout(() => renameLabel.focus(), 100);
  }

  async function handleRename() {
    const entry = entries.find((e) => e.id === renameTargetId);
    if (!entry) return;
    const newLabel = renameLabel.value.trim();
    const newIssuer = renameIssuer.value.trim();
    if (!newLabel) {
      showError(renameError, '이름을 입력하세요');
      return;
    }
    entry.label = newLabel;
    entry.issuer = newIssuer;
    await saveEntries();
    renameModal.classList.add('hidden');
    renameTargetId = null;
    render();
    showToast('이름 변경됨', 'success');
  }

  function closeRename() {
    renameModal.classList.add('hidden');
    renameTargetId = null;
  }

  // ----- 비밀번호 모달 (Promise 기반) -----
  function askPassword({ title, label }) {
    return new Promise((resolve) => {
      pwTitle.textContent = title;
      pwLabel.textContent = label;
      pwInput.value = '';
      clearError(pwError);
      pwModal.classList.remove('hidden');
      setTimeout(() => pwInput.focus(), 100);

      const close = (val) => {
        pwModal.classList.add('hidden');
        confirmPwBtn.removeEventListener('click', onOk);
        cancelPwBtn.removeEventListener('click', onCancel);
        closePwBtn.removeEventListener('click', onCancel);
        pwInput.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onOk = () => {
        const v = pwInput.value;
        if (!v) {
          showError(pwError, '비밀번호를 입력하세요');
          return;
        }
        close(v);
      };
      const onCancel = () => close(null);
      const onKey = (e) => {
        if (e.key === 'Enter') onOk();
        if (e.key === 'Escape') onCancel();
      };
      confirmPwBtn.addEventListener('click', onOk);
      cancelPwBtn.addEventListener('click', onCancel);
      closePwBtn.addEventListener('click', onCancel);
      pwInput.addEventListener('keydown', onKey);
    });
  }

  // ----- 메뉴 -----
  function toggleMenu(open) {
    if (open === undefined) {
      menuDropdown.classList.toggle('hidden');
    } else if (open) {
      menuDropdown.classList.remove('hidden');
    } else {
      menuDropdown.classList.add('hidden');
    }
  }

  // ----- 이벤트 바인딩 -----
  function bindEvents() {
    addBtn.addEventListener('click', () => openForm(null));
    closeFormBtn.addEventListener('click', closeForm);
    cancelFormBtn.addEventListener('click', closeForm);
    saveFormBtn.addEventListener('click', handleSave);

    // 탭
    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => setTab(t.dataset.tab));
    });

    // 검색
    searchBtn.addEventListener('click', () => {
      searchBar.classList.toggle('hidden');
      if (!searchBar.classList.contains('hidden')) {
        setTimeout(() => searchInput.focus(), 50);
      } else {
        searchInput.value = '';
        searchQuery = '';
        render();
      }
    });
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      render();
    });

    // 메뉴
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });
    document.addEventListener('click', () => toggleMenu(false));
    menuDropdown.addEventListener('click', (e) => e.stopPropagation());
    menuDropdown.querySelectorAll('.dropdown-item').forEach((item) => {
      item.addEventListener('click', () => {
        const act = item.dataset.action;
        // 테마 변경은 메뉴를 닫지 않아 사용자가 여러 테마를 비교해볼 수 있음
        const isTheme = act && act.startsWith('theme-');
        if (!isTheme) toggleMenu(false);
        if (act === 'export-plain') exportPlain();
        if (act === 'export-encrypted') exportEncrypted();
        if (act === 'export-gauth') exportGoogleAuth();
        if (act === 'import') importFile.click();
        if (act === 'import-txt') importTxtFile.click();
        if (act === 'delete-all') confirmDeleteAll();
        if (isTheme) setTheme(act.slice('theme-'.length));
      });
    });

    // 복원 파일
    importFile.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) handleImportFile(f);
    });
    importTxtFile.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) handleTxtImport(f);
    });

    // 뷰 토글
    viewToggleBtn.addEventListener('click', async () => {
      viewMode = (viewMode === 'tile') ? 'detail' : 'tile';
      await saveViewMode();
      render();
    });

    // 타일 컨텍스트 메뉴
    document.addEventListener('click', (e) => {
      if (!tileMenu.classList.contains('hidden') && !e.target.closest('#tileMenu')) {
        closeTileMenu();
      }
    });
    tileMenu.addEventListener('click', (e) => e.stopPropagation());
    tileMenu.querySelectorAll('.dropdown-item').forEach((item) => {
      item.addEventListener('click', () => handleTileAction(item.dataset.act));
    });

    // 이름 변경 모달
    closeRenameBtn.addEventListener('click', closeRename);
    cancelRenameBtn.addEventListener('click', closeRename);
    confirmRenameBtn.addEventListener('click', handleRename);
    renameLabel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleRename();
      if (e.key === 'Escape') closeRename();
    });
    renameIssuer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleRename();
      if (e.key === 'Escape') closeRename();
    });

    // Google Auth QR 모달
    closeGauthBtn.addEventListener('click', closeGauth);
    gauthPrevBtn.addEventListener('click', () => {
      if (gauthCurrentPage > 0) { gauthCurrentPage--; renderGauthPage(); }
    });
    gauthNextBtn.addEventListener('click', () => {
      if (gauthCurrentPage < gauthPages.length - 1) { gauthCurrentPage++; renderGauthPage(); }
    });
    gauthCopyUriBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(gauthUriText.value);
        showToast('URI 복사됨', 'success');
      } catch (e) {
        showToast('복사 실패', 'error');
      }
    });

    // 화면 캡처 (폼 내부 버튼 — 폼 에러 영역에 표시)
    captureScreenBtn.addEventListener('click', async () => {
      const err = await startScreenCapture();
      if (err) showError(formError, err);
    });

    // 화면 캡처 (헤더 아이콘 — 토스트로 알림)
    qrScanBtn.addEventListener('click', async () => {
      const err = await startScreenCapture();
      if (err) showToast(err, 'error');
    });

    // QR 파일 입력
    qrDropArea.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') fQrFile.click();
    });
    fQrFile.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) handleQrFile(f);
    });
    // 드래그 앤 드롭
    ['dragenter', 'dragover'].forEach((evt) => {
      qrDropArea.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        qrDropArea.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      qrDropArea.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        qrDropArea.classList.remove('dragover');
      });
    });
    qrDropArea.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files[0];
      if (f) handleQrFile(f);
    });

    // ESC로 모달 닫기
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!tileMenu.classList.contains('hidden')) closeTileMenu();
        else if (!renameModal.classList.contains('hidden')) closeRename();
        else if (!formModal.classList.contains('hidden')) closeForm();
        else if (!gauthModal.classList.contains('hidden')) closeGauth();
      }
    });
  }

  // ----- 화면 드래그 캡처 시작 (공통) -----
  // 성공 시 팝업을 닫고 null 반환, 실패 시 에러 메시지 문자열 반환
  async function startScreenCapture() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'start-capture' });
      if (!resp || !resp.ok) {
        return '캡처 시작 실패: ' + ((resp && resp.error) || '알 수 없는 오류');
      }
      // 팝업을 닫아 사용자가 페이지에서 드래그할 수 있게 함
      window.close();
      return null;
    } catch (e) {
      return '오류: ' + e.message;
    }
  }

  // ----- 캡처 결과 → 즉시 저장 -----
  async function checkPendingCapture() {
    const PENDING_KEY = 'pending_capture';
    let uri = null;
    try {
      if (chrome.storage.session) {
        const r = await chrome.storage.session.get(PENDING_KEY);
        if (r && r[PENDING_KEY]) uri = r[PENDING_KEY];
      }
      if (!uri) {
        const r2 = await chrome.storage.local.get(PENDING_KEY);
        if (r2 && r2[PENDING_KEY]) uri = r2[PENDING_KEY];
      }
    } catch (_) {}
    if (!uri) return;
    // 한 번만 사용
    try { await chrome.storage.session?.remove(PENDING_KEY); } catch (_) {}
    try { await chrome.storage.local.remove(PENDING_KEY); } catch (_) {}

    try {
      const p = BoxOTP.parseOtpauthURI(uri);
      if (p.type !== 'totp') {
        showToast('TOTP만 지원됩니다', 'error');
        return;
      }
      const secret = (p.secret || '').replace(/\s+/g, '').toUpperCase();
      const v = BoxOTP.validateSecret(secret);
      if (!v.ok) {
        showToast('시크릿 키 오류: ' + v.error, 'error');
        return;
      }
      // 중복 시크릿 확인 (이미 등록된 항목이면 스킵)
      if (entries.some((e) => e.secret === secret)) {
        showToast('이미 등록된 OTP입니다', 'error');
        return;
      }
      const entry = {
        id: uid(),
        label: p.label || '',
        issuer: p.issuer || '',
        secret,
        digits: p.digits || 6,
        period: p.period || 30,
        algorithm: (p.algorithm || 'SHA1').toUpperCase(),
        createdAt: Date.now()
      };
      entries.push(entry);
      await saveEntries();
      render();
      const name = entry.issuer ? `${entry.issuer} · ${entry.label}` : (entry.label || '(이름 없음)');
      showToast(`${name} 추가됨`, 'success');
    } catch (e) {
      showToast('QR 파싱 실패: ' + e.message, 'error');
    }
  }

  // ----- 초기화 -----
  async function init() {
    await loadTheme();
    applyTheme();           // FOUC 최소화를 위해 DOM/이벤트 바인딩 전에 한 번 적용
    await loadEntries();
    await loadViewMode();
    bindEvents();
    applyTheme();           // 메뉴 .theme-item의 active 클래스 갱신을 위해 한 번 더
    render();
    startTimerLoop();
    await checkPendingCapture();
  }

  init();
})();

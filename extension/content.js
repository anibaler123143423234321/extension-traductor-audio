/**
 * LiveAudio Translate - Subtítulo flotante.
 * Se inyecta bajo demanda en la pestaña capturada. Usa Shadow DOM para que los
 * estilos de la página no lo rompan y se mueve dentro del elemento en pantalla
 * completa para seguir visible sobre los reproductores de video.
 */
(() => {
  if (window.__liveAudioTranslateOverlay) return;
  window.__liveAudioTranslateOverlay = true;

  const MAX_CHARS = 200;
  const IDLE_MS = 7000;
  const STYLE = `
    :host { all: initial; }
    .box {
      position: fixed;
      left: 50%;
      bottom: 48px;
      transform: translateX(-50%);
      width: min(760px, calc(100vw - 32px));
      box-sizing: border-box;
      background: rgba(15, 23, 42, 0.9);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      box-shadow: 0 20px 35px -5px rgba(0, 0, 0, 0.6), 0 0 15px rgba(56, 189, 248, 0.15);
      color: #f8fafc;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      overflow: hidden;
      pointer-events: auto;
      transition: opacity 0.3s ease;
    }
    .box.dragged { transform: none; }
    .box.hidden { display: none; }
    .box.minimized { width: auto; border-radius: 30px; }
    .box.minimized .body { display: none; }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 12px;
      background: rgba(30, 41, 59, 0.65);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      cursor: grab;
      user-select: none;
      touch-action: none;
    }
    .header:active { cursor: grabbing; }
    .title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #94a3b8;
      white-space: nowrap;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 1.8s infinite;
    }
    .box.idle .dot { animation: none; opacity: 0.5; }
    @keyframes pulse { 0%, 100% { transform: scale(0.95); opacity: 0.7; } 50% { transform: scale(1.3); opacity: 1; } }
    .controls { display: flex; gap: 4px; }
    button {
      all: unset;
      font: 500 11px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif;
      color: #cbd5e1;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      padding: 3px 8px;
      border-radius: 6px;
      cursor: pointer;
    }
    button:hover { background: rgba(255, 255, 255, 0.2); color: #fff; }
    button:focus-visible { outline: 2px solid #38bdf8; }
    .close:hover { background: rgba(239, 68, 68, 0.4); color: #fca5a5; }
    .body { padding: 10px 18px 14px; display: flex; flex-direction: column; gap: 6px; }
    .previous {
      font-size: 0.8em;
      color: #64748b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .previous:empty { display: none; }
    .line { display: flex; align-items: flex-start; gap: 8px; }
    .tag {
      flex-shrink: 0;
      margin-top: 0.25em;
      font: 700 10px/1.4 system-ui, sans-serif;
      padding: 0 5px;
      border-radius: 4px;
    }
    .tag-original { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
    .tag-translated { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .original { color: #94a3b8; font-style: italic; line-height: 1.4; }
    .translated { color: #f1f5f9; font-weight: 600; line-height: 1.4; }
    .text.pending { color: #64748b; font-weight: 400; font-style: italic; }
    .box.translation-only .line-original { display: none; }
  `;

  const state = {
    settings: { captionMode: 'bilingual', fontSize: 20, sourceLang: 'en', targetLang: 'es', overlayPosition: null },
    captions: new Map(),
    dismissed: false,
    idleTimer: null
  };

  // Elimina subtítulos huérfanos de una versión anterior de la extensión.
  document.querySelectorAll('[data-live-audio-translate]').forEach((node) => node.remove());
  const host = document.createElement('div');
  host.dataset.liveAudioTranslate = '';
  host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>${STYLE}</style>
    <div class="box hidden">
      <div class="header">
        <div class="title"><span class="dot"></span><span>LiveAudio Translate</span></div>
        <div class="controls">
          <button data-action="viewer" title="Abrir en ventana independiente / segundo monitor">🗗</button>
          <button data-action="mode" title="Bilingüe o solo traducción"></button>
          <button data-action="smaller" title="Letra más pequeña">A-</button>
          <button data-action="bigger" title="Letra más grande">A+</button>
          <button data-action="minimize" title="Minimizar">_</button>
          <button data-action="close" class="close" title="Ocultar subtítulos">✕</button>
        </div>
      </div>
      <div class="body">
        <div class="previous"></div>
        <div class="line line-original"><span class="tag tag-original"></span><span class="text original"></span></div>
        <div class="line line-translated"><span class="tag tag-translated"></span><span class="text translated pending">Escuchando…</span></div>
      </div>
    </div>`;

  const box = shadow.querySelector('.box');
  const header = shadow.querySelector('.header');
  const previousEl = shadow.querySelector('.previous');
  const originalEl = shadow.querySelector('.original');
  const translatedEl = shadow.querySelector('.translated');
  const tagOriginal = shadow.querySelector('.tag-original');
  const tagTranslated = shadow.querySelector('.tag-translated');
  const modeButton = shadow.querySelector('[data-action="mode"]');

  attachHost();
  loadSettings();
  setupDrag();
  setupControls();

  // -------------------------------------------------------------------------
  function attachHost() {
    // En pantalla completa solo se ve el elemento a pantalla completa y su contenido.
    const fullscreen = document.fullscreenElement;
    const parent = fullscreen && fullscreen.tagName !== 'VIDEO' ? fullscreen : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }

  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get(Object.keys(state.settings));
      applySettings(stored);
    } catch { /* contexto de la extensión invalidado */ }
  }

  function applySettings(patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && key in state.settings) state.settings[key] = value;
    }
    const { captionMode, fontSize, sourceLang, targetLang, overlayPosition } = state.settings;
    const translationOnly = captionMode === 'translation' || captionMode === 'spanish';
    box.classList.toggle('translation-only', translationOnly);
    modeButton.textContent = translationOnly ? `Solo ${targetLang.toUpperCase()}` : `${sourceLang.toUpperCase()}+${targetLang.toUpperCase()}`;
    tagOriginal.textContent = sourceLang.toUpperCase();
    tagTranslated.textContent = targetLang.toUpperCase();
    box.style.fontSize = `${fontSize}px`;
    originalEl.style.fontSize = `${Math.max(12, Math.round(fontSize * 0.72))}px`;
    applyPosition(overlayPosition);
  }

  function applyPosition(position) {
    if (!position) {
      box.classList.remove('dragged');
      box.style.left = box.style.top = box.style.bottom = '';
      return;
    }
    box.classList.add('dragged');
    const maxX = Math.max(0, window.innerWidth - box.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - box.offsetHeight);
    box.style.left = `${Math.min(Math.max(0, position.x * window.innerWidth), maxX)}px`;
    box.style.top = `${Math.min(Math.max(0, position.y * window.innerHeight), maxY)}px`;
    box.style.bottom = 'auto';
  }

  function setupDrag() {
    let drag = null;
    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const rect = box.getBoundingClientRect();
      drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      header.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    header.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const x = Math.min(Math.max(0, event.clientX - drag.dx), window.innerWidth - box.offsetWidth);
      const y = Math.min(Math.max(0, event.clientY - drag.dy), window.innerHeight - box.offsetHeight);
      box.classList.add('dragged');
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.bottom = 'auto';
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      const rect = box.getBoundingClientRect();
      saveSetting({ overlayPosition: { x: rect.left / window.innerWidth, y: rect.top / window.innerHeight } });
    };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);
    // Doble clic en la barra: vuelve a la posición por defecto.
    header.addEventListener('dblclick', (event) => {
      if (!event.target.closest('button')) saveSetting({ overlayPosition: null });
    });
  }

  function setupControls() {
    shadow.querySelector('.controls').addEventListener('click', (event) => {
      const action = event.target.closest('button')?.dataset.action;
      const { fontSize, captionMode } = state.settings;
      switch (action) {
        case 'viewer':
          safeSend({ action: 'OPEN_VIEWER' });
          break;
        case 'mode':
          saveSetting({ captionMode: captionMode === 'bilingual' ? 'translation' : 'bilingual' });
          break;
        case 'smaller':
          saveSetting({ fontSize: Math.max(14, fontSize - 2) });
          break;
        case 'bigger':
          saveSetting({ fontSize: Math.min(48, fontSize + 2) });
          break;
        case 'minimize': {
          const minimized = box.classList.toggle('minimized');
          event.target.textContent = minimized ? '▢' : '_';
          break;
        }
        case 'close':
          state.dismissed = true;
          box.classList.add('hidden');
          break;
      }
    });
  }

  function saveSetting(patch) {
    applySettings(patch);
    try {
      chrome.storage.local.set(patch);
    } catch { /* contexto invalidado */ }
  }

  function safeSend(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch { /* contexto invalidado */ }
  }

  function show() {
    state.dismissed = false;
    attachHost();
    box.classList.remove('hidden');
    applyPosition(state.settings.overlayPosition);
  }

  function hide() {
    box.classList.add('hidden');
    state.captions.clear();
    previousEl.textContent = '';
    originalEl.textContent = '';
    translatedEl.textContent = 'Escuchando…';
    translatedEl.classList.add('pending');
  }

  function renderCaption(caption) {
    state.captions.set(caption.id, caption);
    const ids = [...state.captions.keys()].sort((a, b) => a - b);
    while (ids.length > 3) state.captions.delete(ids.shift());

    const currentId = ids[ids.length - 1];
    const current = state.captions.get(currentId);
    const previous = state.captions.get(currentId - 1);

    previousEl.textContent = previous ? tail(previous.translated || previous.original, MAX_CHARS) : '';
    originalEl.textContent = tail(current.original, MAX_CHARS);
    const translated = current.translationFailed ? current.original : current.translated;
    translatedEl.textContent = translated ? tail(translated, MAX_CHARS) : '…';
    translatedEl.classList.toggle('pending', !translated || current.translationFailed);

    if (!state.dismissed && box.classList.contains('hidden')) show();
    box.classList.remove('idle');
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => box.classList.add('idle'), IDLE_MS);
  }

  function tail(text, max) {
    if (!text || text.length <= max) return text || '';
    const slice = text.slice(-max);
    const space = slice.indexOf(' ');
    return `…${space > 0 && space < 30 ? slice.slice(space + 1) : slice}`;
  }

  // -------------------------------------------------------------------------
  document.addEventListener('fullscreenchange', attachHost);
  window.addEventListener('resize', () => applyPosition(state.settings.overlayPosition));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const patch = {};
    for (const key of Object.keys(state.settings)) {
      if (changes[key]) patch[key] = changes[key].newValue;
    }
    if (Object.keys(patch).length) applySettings(patch);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message?.action) {
      case 'OVERLAY_SHOW':
        show();
        sendResponse({ ok: true });
        break;
      case 'OVERLAY_HIDE':
        hide();
        sendResponse({ ok: true });
        break;
      case 'OVERLAY_CAPTION':
        renderCaption(message.caption);
        break;
    }
  });
})();

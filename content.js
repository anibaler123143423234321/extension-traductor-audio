/**
 * LiveAudio Translate - Content Script
 * Inyecta y controla la caja de subtítulos flotante, arrastrable y redimensionable sobre la página web activa.
 */

(function () {
  if (window.__liveAudioTranslateInjected) return;
  window.__liveAudioTranslateInjected = true;

  let overlayElement = null;
  let textEnElement = null;
  let textEsElement = null;
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let currentFontSize = 16;
  let isBilingual = true;

  function createOverlay() {
    if (document.getElementById('live-audio-translate-overlay')) return;

    overlayElement = document.createElement('div');
    overlayElement.id = 'live-audio-translate-overlay';
    overlayElement.className = 'lat-hidden';

    overlayElement.innerHTML = `
      <div class="lat-header" id="lat-drag-handle">
        <div class="lat-title-wrap">
          <span class="lat-pulse-dot" title="Escuchando audio"></span>
          <span>Audio Translate</span>
        </div>
        <div class="lat-controls">
          <button class="lat-btn" id="lat-btn-popout" title="Mover a Segundo Monitor / Ventana Independiente">🗗</button>
          <button class="lat-btn" id="lat-toggle-mode" title="Cambiar modo bilingüe / solo español">EN+ES</button>
          <button class="lat-btn" id="lat-font-minus" title="Reducir tamaño de letra">A-</button>
          <button class="lat-btn" id="lat-font-plus" title="Aumentar tamaño de letra">A+</button>
          <button class="lat-btn" id="lat-btn-min" title="Minimizar / Expandir">_</button>
          <button class="lat-btn lat-btn-close" id="lat-btn-close" title="Ocultar subtítulos">✕</button>
        </div>
      </div>
      <div class="lat-body">
        <div class="lat-line-en">
          <span class="lat-tag lat-tag-en">EN</span>
          <span class="lat-text lat-waiting" id="lat-text-en">Esperando audio en inglés...</span>
        </div>
        <div class="lat-line-es">
          <span class="lat-tag lat-tag-es">ES</span>
          <span class="lat-text lat-waiting" id="lat-text-es">Traduciendo en tiempo real...</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlayElement);

    textEnElement = document.getElementById('lat-text-en');
    textEsElement = document.getElementById('lat-text-es');

    setupDragAndDrop();
    setupControls();
  }

  function setupDragAndDrop() {
    const handle = document.getElementById('lat-drag-handle');

    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;

      const rect = overlayElement.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;

      // Desactivar centrado automático por transform al comenzar el arrastre manual
      overlayElement.style.transform = 'none';
      overlayElement.style.bottom = 'auto';
      overlayElement.style.left = `${rect.left}px`;
      overlayElement.style.top = `${rect.top}px`;

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      let newX = e.clientX - dragOffset.x;
      let newY = e.clientY - dragOffset.y;

      // Limitar a los bordes de la pantalla
      const maxX = window.innerWidth - overlayElement.offsetWidth;
      const maxY = window.innerHeight - overlayElement.offsetHeight;

      newX = Math.max(10, Math.min(newX, maxX - 10));
      newY = Math.max(10, Math.min(newY, maxY - 10));

      overlayElement.style.left = `${newX}px`;
      overlayElement.style.top = `${newY}px`;
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  function setupControls() {
    const btnPopout = document.getElementById('lat-btn-popout');
    const btnToggleMode = document.getElementById('lat-toggle-mode');
    const btnFontPlus = document.getElementById('lat-font-plus');
    const btnFontMinus = document.getElementById('lat-font-minus');
    const btnMin = document.getElementById('lat-btn-min');
    const btnClose = document.getElementById('lat-btn-close');

    // Mover a ventana externa (Segundo Monitor) y limpiar pantalla compartida
    if (btnPopout) {
      btnPopout.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'OPEN_VIEWER_WINDOW' });
        overlayElement.classList.add('lat-hidden');
      });
    }

    // Cambiar entre Bilingüe y Solo Español
    btnToggleMode.addEventListener('click', () => {
      isBilingual = !isBilingual;
      if (isBilingual) {
        overlayElement.classList.remove('lat-spanish-only');
        btnToggleMode.textContent = 'EN+ES';
      } else {
        overlayElement.classList.add('lat-spanish-only');
        btnToggleMode.textContent = 'SOLO ES';
      }
    });

    // Aumentar tamaño
    btnFontPlus.addEventListener('click', () => {
      if (currentFontSize < 28) {
        currentFontSize += 2;
        updateFontSize();
      }
    });

    // Reducir tamaño
    btnFontMinus.addEventListener('click', () => {
      if (currentFontSize > 12) {
        currentFontSize -= 2;
        updateFontSize();
      }
    });

    // Minimizar / Restaurar
    btnMin.addEventListener('click', () => {
      overlayElement.classList.toggle('lat-minimized');
      btnMin.textContent = overlayElement.classList.contains('lat-minimized') ? '▢' : '_';
    });

    // Cerrar / Ocultar
    btnClose.addEventListener('click', () => {
      overlayElement.classList.add('lat-hidden');
    });
  }

  function updateFontSize() {
    if (textEsElement) textEsElement.style.fontSize = `${currentFontSize}px`;
    if (textEnElement) textEnElement.style.fontSize = `${Math.max(11, currentFontSize - 3)}px`;
  }

  function updateSubtitles(english, spanish) {
    if (!overlayElement) createOverlay();

    overlayElement.classList.remove('lat-hidden');

    if (english && textEnElement) {
      textEnElement.classList.remove('lat-waiting');
      textEnElement.textContent = english;
      textEnElement.classList.remove('lat-fade-in');
      void textEnElement.offsetWidth; // Trigger reflow
      textEnElement.classList.add('lat-fade-in');
    }

    if (spanish && textEsElement) {
      textEsElement.classList.remove('lat-waiting');
      textEsElement.textContent = spanish;
      textEsElement.classList.remove('lat-fade-in');
      void textEsElement.offsetWidth; // Trigger reflow
      textEsElement.classList.add('lat-fade-in');
    }
  }

  // Escuchar mensajes del background worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SHOW_OVERLAY') {
      if (!overlayElement) createOverlay();
      overlayElement.classList.remove('lat-hidden');
      sendResponse({ ok: true });
    } else if (message.action === 'HIDE_OVERLAY') {
      if (overlayElement) overlayElement.classList.add('lat-hidden');
      sendResponse({ ok: true });
    } else if (message.action === 'UPDATE_SUBTITLE') {
      updateSubtitles(message.english, message.spanish);
      sendResponse({ ok: true });
    }
  });

  // Inicializar al cargar
  createOverlay();
})();

/**
 * LiveAudio Translate - Popup Controller
 * Motor exclusivo: Groq Whisper Turbo + Traducción Gratuita
 */

document.addEventListener('DOMContentLoaded', async () => {
  const btnToggleCapture = document.getElementById('btnToggleCapture');
  const btnIcon = document.getElementById('btnIcon');
  const btnText = document.getElementById('btnText');
  const statusBadge = document.getElementById('statusBadge');
  const tabTitle = document.getElementById('tabTitle');
  const visualizer = document.getElementById('visualizer');

  const groqKeyInput = document.getElementById('groqKeyInput');
  const btnSaveGroq = document.getElementById('btnSaveGroq');

  const intervalSelect = document.getElementById('intervalSelect');
  const modeSelect = document.getElementById('modeSelect');

  const historyFeed = document.getElementById('historyFeed');
  const btnCopyHistory = document.getElementById('btnCopyHistory');
  const btnDownloadHistory = document.getElementById('btnDownloadHistory');
  const btnClearHistory = document.getElementById('btnClearHistory');

  const btnOpenViewer = document.getElementById('btnOpenViewer');
  const srcTab = document.getElementById('srcTab');
  const srcWindow = document.getElementById('srcWindow');

  let activeTab = null;
  let isCapturing = false;

  // Abrir ventana para Segundo Monitor
  if (btnOpenViewer) {
    btnOpenViewer.addEventListener('click', () => {
      chrome.windows.create({
        url: chrome.runtime.getURL('viewer.html'),
        type: 'popup',
        width: 760,
        height: 540,
        focused: true
      });
    });
  }

  if (srcTab && srcWindow) {
    srcTab.addEventListener('change', () => {
      btnText.textContent = isCapturing ? 'Detener Transcripción' : 'Iniciar en esta pestaña';
      tabTitle.textContent = activeTab?.title || 'Pestaña activa';
    });

    srcWindow.addEventListener('change', () => {
      btnText.textContent = isCapturing ? 'Detener Transcripción' : 'Abrir ventana y elegir fuente...';
      tabTitle.textContent = 'Ventana compartida / Zoom';
    });
  }

  // 1. Obtener pestaña activa
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0) {
    activeTab = tabs[0];
    tabTitle.textContent = activeTab.title || activeTab.url;
  }

  // 2. Cargar configuraciones guardadas
  const stored = await chrome.storage.local.get([
    'groqApiKey',
    'chunkInterval',
    'captionMode',
    'sessionHistory'
  ]);

  if (stored.groqApiKey) groqKeyInput.value = stored.groqApiKey;
  if (stored.chunkInterval) intervalSelect.value = stored.chunkInterval;
  if (stored.captionMode) modeSelect.value = stored.captionMode;

  renderHistory(stored.sessionHistory || []);

  // 3. Consultar estado actual
  chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (res) => {
    if (res) {
      isCapturing = res.isCapturing;
      updateCaptureUI(isCapturing);
    }
  });

  // 4. Guardar clave Groq
  btnSaveGroq.addEventListener('click', async () => {
    const key = groqKeyInput.value.trim();
    if (!key) {
      alert('Ingresa tu clave gratuita de Groq Cloud (gsk_...).');
      return;
    }
    await chrome.storage.local.set({ groqApiKey: key });
    btnSaveGroq.textContent = '✓ Guardado';
    setTimeout(() => { btnSaveGroq.textContent = 'Guardar'; }, 1500);
  });

  // Alternar visualización de clave (ojito)
  document.querySelectorAll('.toggle-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🔒';
      } else {
        input.type = 'password';
        btn.textContent = '👁';
      }
    });
  });

  // 5. Botón maestro de inicio/parada
  btnToggleCapture.addEventListener('click', async () => {
    if (!isCapturing) {
      // Si el usuario eligió "Otra ventana / Zoom", abrir ventana de segundo monitor directamente
      if (srcWindow && srcWindow.checked) {
        chrome.windows.create({
          url: chrome.runtime.getURL('viewer.html'),
          type: 'popup',
          width: 760,
          height: 540,
          focused: true
        });
        return;
      }

      const { groqApiKey } = await chrome.storage.local.get(['groqApiKey']);
      const key = groqKeyInput.value.trim() || groqApiKey;

      if (!key) {
        alert('Debes guardar tu clave gratuita de Groq (gsk_...) antes de iniciar.');
        groqKeyInput.focus();
        return;
      }

      btnText.textContent = 'Iniciando captura...';
      btnToggleCapture.disabled = true;

      chrome.runtime.sendMessage({
        action: 'START_SESSION',
        tabId: activeTab.id,
        tabTitle: activeTab.title
      }, (res) => {
        btnToggleCapture.disabled = false;
        if (res && res.success) {
          isCapturing = true;
          updateCaptureUI(true);
        } else {
          alert('Error: ' + (res?.error || 'No se pudo iniciar la captura.'));
          updateCaptureUI(false);
        }
      });
    } else {
      btnText.textContent = 'Deteniendo...';
      btnToggleCapture.disabled = true;

      chrome.runtime.sendMessage({ action: 'STOP_SESSION' }, () => {
        btnToggleCapture.disabled = false;
        isCapturing = false;
        updateCaptureUI(false);
      });
    }
  });

  // Opciones
  intervalSelect.addEventListener('change', () => {
    chrome.storage.local.set({ chunkInterval: parseInt(intervalSelect.value, 10) });
  });

  modeSelect.addEventListener('change', () => {
    chrome.storage.local.set({ captionMode: modeSelect.value });
    if (activeTab) {
      chrome.tabs.sendMessage(activeTab.id, { action: 'SET_MODE', mode: modeSelect.value }).catch(() => {});
    }
  });

  // Historial
  btnCopyHistory.addEventListener('click', async () => {
    const { sessionHistory } = await chrome.storage.local.get(['sessionHistory']);
    if (!sessionHistory || sessionHistory.length === 0) {
      alert('No hay transcripciones.');
      return;
    }
    const txt = sessionHistory.map(i => `[${i.time}]\nEN: ${i.english}\nES: ${i.spanish}\n`).join('\n');
    navigator.clipboard.writeText(txt).then(() => {
      const orig = btnCopyHistory.textContent;
      btnCopyHistory.textContent = '¡Copiado!';
      setTimeout(() => { btnCopyHistory.textContent = orig; }, 1500);
    });
  });

  btnDownloadHistory.addEventListener('click', async () => {
    const { sessionHistory } = await chrome.storage.local.get(['sessionHistory']);
    if (!sessionHistory || sessionHistory.length === 0) {
      alert('No hay transcripciones.');
      return;
    }
    const txt = `--- TRANSCRIPCIÓN (LiveAudio Translate) ---\n` +
      sessionHistory.map(i => `[${i.time}]\n[EN] ${i.english}\n[ES] ${i.spanish}\n`).join('\n');
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcripcion-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a);
  });

  btnClearHistory.addEventListener('click', async () => {
    if (confirm('¿Vaciar historial?')) {
      await chrome.storage.local.set({ sessionHistory: [] });
      renderHistory([]);
    }
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.sessionHistory) {
      renderHistory(changes.sessionHistory.newValue || []);
    }
  });

  function updateCaptureUI(recording) {
    if (recording) {
      btnToggleCapture.classList.add('recording');
      btnIcon.textContent = '■';
      btnText.textContent = 'Detener Transcripción';
      statusBadge.classList.add('active');
      statusBadge.querySelector('.status-text').textContent = 'Traduciendo';
      visualizer.classList.add('active');
    } else {
      btnToggleCapture.classList.remove('recording');
      btnIcon.textContent = '▶';
      btnText.textContent = (srcWindow && srcWindow.checked) ? 'Abrir ventana y elegir fuente...' : 'Iniciar en esta pestaña';
      statusBadge.classList.remove('active');
      statusBadge.querySelector('.status-text').textContent = 'Listo';
      visualizer.classList.remove('active');
    }
  }

  function renderHistory(items) {
    if (!items || items.length === 0) {
      historyFeed.innerHTML = '<div class="history-empty">Las frases traducidas aparecerán aquí en vivo...</div>';
      return;
    }
    historyFeed.innerHTML = '';
    [...items].reverse().forEach(item => {
      const row = document.createElement('div');
      row.className = 'history-item';
      row.innerHTML = `
        <span class="history-time">${item.time}</span>
        <span class="history-en">${escapeHtml(item.english)}</span>
        <span class="history-es">${escapeHtml(item.spanish)}</span>
      `;
      historyFeed.appendChild(row);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
});

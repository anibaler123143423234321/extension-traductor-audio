/**
 * LiveAudio Translate - Popup.
 */
import { loadSettings, saveSettings, ENGINE_INFO } from './lib/settings.js';
import { fillLanguageSelect, getLanguage } from './lib/languages.js';
import {
  IS_MAC,
  SHORTCUT_LABEL,
  normalizeHistoryItem,
  historyToText,
  downloadText,
  timestampForFile,
  flashButton,
  sendMessage
} from './lib/ui.js';

const $ = (id) => document.getElementById(id);

const els = {
  statusBadge: $('statusBadge'),
  statusText: $('statusText'),
  langSubtitle: $('langSubtitle'),
  sourceHint: $('sourceHint'),
  btnToggle: $('btnToggle'),
  btnIcon: $('btnIcon'),
  btnText: $('btnText'),
  btnViewer: $('btnViewer'),
  liveInfo: $('liveInfo'),
  engineName: $('engineName'),
  liveTitle: $('liveTitle'),
  notice: $('notice'),
  noticeText: $('noticeText'),
  noticeAction: $('noticeAction'),
  noticeClose: $('noticeClose'),
  sourceLang: $('sourceLang'),
  targetLang: $('targetLang'),
  btnSwap: $('btnSwap'),
  engineSelect: $('engineSelect'),
  engineHint: $('engineHint'),
  keysCard: $('keysCard'),
  deepgramKey: $('deepgramKey'),
  groqKey: $('groqKey'),
  btnSaveKeys: $('btnSaveKeys'),
  modeSelect: $('modeSelect'),
  fontSize: $('fontSize'),
  fontSizeValue: $('fontSizeValue'),
  historyFeed: $('historyFeed'),
  btnCopy: $('btnCopy'),
  btnDownload: $('btnDownload'),
  btnClear: $('btnClear'),
  shortcut: $('shortcut'),
  btnShortcuts: $('btnShortcuts')
};

const SOURCE_INFO = {
  tab: {
    button: 'Iniciar en esta pestaña',
    hint: 'Traduce el audio de la pestaña actual: YouTube, Meet, Teams o Zoom web, cursos, podcasts…'
  },
  display: {
    button: 'Elegir ventana o pantalla…',
    hint: IS_MAC
      ? 'Para apps de escritorio (Zoom, Teams). En Mac, el audio del sistema requiere macOS 14.2+ y Chrome 141+; si no aparece, abre la reunión en una pestaña.'
      : 'Para apps de escritorio (Zoom, Teams). En Windows elige «Pantalla completa» y activa «Compartir también el audio del sistema».'
  },
  mic: {
    button: 'Iniciar con el micrófono',
    hint: 'Traduce lo que capta tu micrófono: clases presenciales, conversaciones, llamadas por altavoz.'
  }
};

const ENGINE_LABELS = { webspeech: 'Chrome Live', deepgram: 'Deepgram', groq: 'Groq Whisper' };

let settings;
let status = { capturing: false };
let activeTab = null;
let busy = false;
let localNotice = false;

init();

async function init() {
  settings = await loadSettings();
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  fillLanguageSelect(els.sourceLang, settings.sourceLang);
  fillLanguageSelect(els.targetLang, settings.targetLang);
  els.engineSelect.replaceChildren(
    ...Object.entries(ENGINE_INFO).map(([id, info]) => new Option(info.label, id, false, id === settings.engine))
  );
  document.querySelector(`input[name="source"][value="${settings.source}"]`).checked = true;
  els.deepgramKey.value = settings.deepgramApiKey;
  els.groqKey.value = settings.groqApiKey;
  els.modeSelect.value = settings.captionMode;
  els.fontSize.value = settings.fontSize;
  els.shortcut.textContent = SHORTCUT_LABEL;

  renderSettings();
  bindEvents();
  await refreshStatus();
  renderHistory((await chrome.storage.local.get('sessionHistory')).sessionHistory);
}

function bindEvents() {
  els.btnToggle.addEventListener('click', toggleCapture);
  els.btnViewer.addEventListener('click', () => sendMessage({ action: 'OPEN_VIEWER' }));

  document.querySelectorAll('input[name="source"]').forEach((radio) => {
    radio.addEventListener('change', () => updateSetting({ source: radio.value }, { restart: false }));
  });

  els.sourceLang.addEventListener('change', () => updateSetting({ sourceLang: els.sourceLang.value }));
  els.targetLang.addEventListener('change', () => updateSetting({ targetLang: els.targetLang.value }));
  els.btnSwap.addEventListener('click', () => {
    const patch = { sourceLang: settings.targetLang, targetLang: settings.sourceLang };
    els.sourceLang.value = patch.sourceLang;
    els.targetLang.value = patch.targetLang;
    updateSetting(patch);
  });
  els.engineSelect.addEventListener('change', () => updateSetting({ engine: els.engineSelect.value }));
  els.modeSelect.addEventListener('change', () => updateSetting({ captionMode: els.modeSelect.value }, { restart: false }));
  els.fontSize.addEventListener('input', () => updateSetting({ fontSize: Number(els.fontSize.value) }, { restart: false }));

  els.btnSaveKeys.addEventListener('click', async () => {
    await updateSetting({ deepgramApiKey: els.deepgramKey.value.trim(), groqApiKey: els.groqKey.value.trim() });
    flashButton(els.btnSaveKeys, '✓ Guardadas');
  });

  document.querySelectorAll('.toggle-eye').forEach((button) => {
    button.addEventListener('click', () => {
      const input = $(button.dataset.target);
      input.type = input.type === 'password' ? 'text' : 'password';
      button.textContent = input.type === 'password' ? '👁' : '🔒';
    });
  });

  els.noticeClose.addEventListener('click', () => {
    localNotice = false;
    els.notice.hidden = true;
    sendMessage({ action: 'CLEAR_NOTICE' });
  });

  els.btnCopy.addEventListener('click', copyHistory);
  els.btnDownload.addEventListener('click', downloadHistory);
  els.btnClear.addEventListener('click', clearHistory);
  els.btnShortcuts.addEventListener('click', (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && (changes.session || changes.notice)) refreshStatus();
    if (area === 'local' && changes.sessionHistory) renderHistory(changes.sessionHistory.newValue);
  });
}

// ---------------------------------------------------------------------------
// Captura
// ---------------------------------------------------------------------------
async function toggleCapture() {
  if (busy) return;
  if (status.capturing) {
    await withBusy('Deteniendo…', () => sendMessage({ action: 'STOP_SESSION' }));
    return;
  }

  localNotice = false;
  const missingKey = missingKeyFor(settings.engine);
  if (missingKey) {
    localNotice = true;
    showNotice({ level: 'error', code: `${missingKey}-missing-key`, message: `Agrega tu clave de ${missingKey === 'groq' ? 'Groq' : 'Deepgram'} o elige el motor Automático.` });
    els.keysCard.open = true;
    return;
  }

  if (settings.source === 'display') {
    await sendMessage({ action: 'OPEN_VIEWER', capture: true });
    window.close();
    return;
  }
  await startOnActiveTab();
}

async function startOnActiveTab() {
  if (!activeTab) return;
  const response = await withBusy('Iniciando…', () =>
    sendMessage({ action: 'START_SESSION', tabId: activeTab.id, tabTitle: activeTab.title, source: settings.source })
  );
  if (!response?.ok) showNotice({ level: 'error', ...response?.error });
}

async function withBusy(label, task) {
  busy = true;
  els.btnToggle.disabled = true;
  els.btnText.textContent = label;
  try {
    return await task();
  } finally {
    busy = false;
    els.btnToggle.disabled = false;
    await refreshStatus();
  }
}

function missingKeyFor(engine) {
  if (engine === 'deepgram' && !settings.deepgramApiKey) return 'deepgram';
  if (engine === 'groq' && !settings.groqApiKey) return 'groq';
  return null;
}

async function updateSetting(patch, { restart = true } = {}) {
  Object.assign(settings, patch);
  await saveSettings(patch);
  renderSettings();

  // Los cambios de idioma, motor o claves se aplican reiniciando la captura.
  if (restart && status.capturing && status.tabId === activeTab?.id && status.source === settings.source) {
    await startOnActiveTab();
  }
}

// ---------------------------------------------------------------------------
// Renderizado
// ---------------------------------------------------------------------------
async function refreshStatus() {
  const response = await sendMessage({ action: 'GET_STATUS' });
  if (response && response.ok !== false) status = response;
  renderStatus();
}

function renderStatus() {
  if (busy) return;
  const capturing = Boolean(status.capturing);
  const hasError = status.notice?.level === 'error';

  els.statusBadge.classList.toggle('active', capturing);
  els.statusBadge.classList.toggle('error', !capturing && hasError);
  els.statusText.textContent = capturing ? 'En vivo' : hasError ? 'Error' : 'Listo';

  els.btnToggle.classList.toggle('recording', capturing);
  els.btnIcon.textContent = capturing ? '■' : '▶';
  els.btnText.textContent = capturing ? 'Detener traducción' : SOURCE_INFO[settings.source].button;

  els.liveInfo.hidden = !capturing;
  els.engineName.textContent = ENGINE_LABELS[status.engine] ?? '—';
  els.liveTitle.textContent = status.source === 'mic' ? '🎙️ Micrófono' : status.tabTitle ?? '';
  els.liveTitle.title = els.liveTitle.textContent;

  if (status.notice) showNotice(status.notice);
  else if (!localNotice) els.notice.hidden = true;
}

function renderSettings() {
  const from = getLanguage(settings.sourceLang);
  const to = getLanguage(settings.targetLang);
  els.langSubtitle.textContent = `${from.label} → ${to.label} en vivo`;
  els.sourceHint.textContent = SOURCE_INFO[settings.source].hint;
  els.engineHint.textContent = ENGINE_INFO[settings.engine].hint;
  els.fontSizeValue.textContent = `${settings.fontSize}px`;
  if (!status.capturing && !busy) els.btnText.textContent = SOURCE_INFO[settings.source].button;
}

function showNotice({ level = 'error', code, message }) {
  if (!message) return;
  els.notice.hidden = false;
  els.notice.className = `notice ${level}`;
  els.noticeText.textContent = message;

  const action = noticeAction(code);
  els.noticeAction.hidden = !action;
  if (action) {
    els.noticeAction.textContent = action.label;
    els.noticeAction.onclick = action.run;
  }
}

function noticeAction(code = '') {
  if (code === 'mic-permission') {
    return { label: 'Conceder permiso', run: () => sendMessage({ action: 'OPEN_PERMISSION' }) };
  }
  if (/^(deepgram|groq)-(missing-key|auth|connect)$/.test(code)) {
    return { label: 'Abrir claves', run: () => { els.keysCard.open = true; els.deepgramKey.focus(); } };
  }
  return null;
}

function renderHistory(history = []) {
  const items = history.slice(-60).reverse().map(normalizeHistoryItem);
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'Las frases traducidas aparecerán aquí en vivo…';
    els.historyFeed.replaceChildren(empty);
    return;
  }
  els.historyFeed.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement('div');
      row.className = 'history-item';
      row.append(
        textSpan('history-time', item.time),
        textSpan('history-original', item.original),
        textSpan('history-translated', item.translated || '—')
      );
      return row;
    })
  );
}

function textSpan(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------
async function getHistory() {
  const { sessionHistory = [] } = await chrome.storage.local.get('sessionHistory');
  return sessionHistory;
}

async function copyHistory() {
  const history = await getHistory();
  if (!history.length) return flashButton(els.btnCopy, 'Vacío');
  await navigator.clipboard.writeText(historyToText(history, settings));
  flashButton(els.btnCopy, '✓ Copiado');
}

async function downloadHistory() {
  const history = await getHistory();
  if (!history.length) return flashButton(els.btnDownload, 'Vacío');
  downloadText(`transcripcion-${timestampForFile()}.txt`, historyToText(history, settings));
}

async function clearHistory() {
  if (!confirm('¿Borrar todo el historial?')) return;
  await chrome.storage.local.set({ sessionHistory: [] });
}

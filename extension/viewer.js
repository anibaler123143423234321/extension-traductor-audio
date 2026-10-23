/**
 * LiveAudio Translate - Ventana de segundo monitor.
 * Muestra los subtítulos de la pestaña capturada y puede capturar por sí misma
 * el audio de otra ventana, app o pantalla (Zoom, Teams…) con getDisplayMedia.
 */
import { loadSettings, saveSettings, clamp } from './lib/settings.js';
import { getLanguage } from './lib/languages.js';
import { CaptureSession } from './lib/capture-session.js';
import {
  IS_MAC,
  formatTime,
  normalizeHistoryItem,
  historyToText,
  downloadText,
  timestampForFile,
  flashButton,
  sendMessage
} from './lib/ui.js';

const $ = (id) => document.getElementById(id);
const els = {
  statusIndicator: $('statusIndicator'),
  statusText: $('statusText'),
  engineBadge: $('engineBadge'),
  btnCapture: $('btnCapture'),
  captureText: $('captureText'),
  btnMode: $('btnMode'),
  modeText: $('modeText'),
  btnFontDec: $('btnFontDec'),
  btnFontInc: $('btnFontInc'),
  btnPip: $('btnPip'),
  btnFullscreen: $('btnFullscreen'),
  notice: $('notice'),
  noticeText: $('noticeText'),
  noticeAction: $('noticeAction'),
  noticeClose: $('noticeClose'),
  liveCard: $('liveCard'),
  liveClock: $('liveClock'),
  textPrevious: $('textPrevious'),
  textTranslated: $('textTranslated'),
  textOriginal: $('textOriginal'),
  tagTranslated: $('tagTranslated'),
  tagOriginal: $('tagOriginal'),
  chkAutoScroll: $('chkAutoScroll'),
  btnCopy: $('btnCopy'),
  btnExport: $('btnExport'),
  btnClear: $('btnClear'),
  streamList: $('streamList')
};

const ENGINE_LABELS = { webspeech: 'Chrome Live', deepgram: 'Deepgram', groq: 'Groq Whisper' };
const MAX_CHARS = 260;

let settings;
let viewerFontSize = 30;
let session = null;
let pipWindow = null;
let lastRenderedTs = null;
const captions = new Map();

init();

async function init() {
  settings = await loadSettings();
  ({ viewerFontSize = 30 } = await chrome.storage.local.get('viewerFontSize'));
  applySettings();
  renderStream((await chrome.storage.local.get('sessionHistory')).sessionHistory ?? []);
  bindEvents();

  const status = await sendMessage({ action: 'GET_STATUS' });
  if (status?.capturing) setLive(true, ENGINE_LABELS[status.engine]);

  if (new URLSearchParams(location.search).has('capture')) promptCapture();
}

function bindEvents() {
  els.btnCapture.addEventListener('click', () => (session ? stopCapture() : startCapture()));
  els.btnMode.addEventListener('click', () => {
    saveSettings({ captionMode: settings.captionMode === 'bilingual' ? 'translation' : 'bilingual' });
  });
  els.btnFontInc.addEventListener('click', () => setFontSize(viewerFontSize + 3));
  els.btnFontDec.addEventListener('click', () => setFontSize(viewerFontSize - 3));
  els.btnFullscreen.addEventListener('click', toggleFullscreen);
  els.btnPip.addEventListener('click', togglePip);
  els.noticeClose.addEventListener('click', () => { els.notice.hidden = true; });
  els.btnCopy.addEventListener('click', copyHistory);
  els.btnExport.addEventListener('click', exportHistory);
  els.btnClear.addEventListener('click', clearHistory);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === 'CAPTION' && !session) renderCaption(message.caption);
    if (message?.action === 'VIEWER_PROMPT_CAPTURE') promptCapture();
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local') {
      if (changes.sessionHistory) renderStream(changes.sessionHistory.newValue ?? []);
      if (['captionMode', 'sourceLang', 'targetLang', 'engine', 'deepgramApiKey', 'groqApiKey'].some((k) => changes[k])) {
        settings = await loadSettings();
        applySettings();
      }
    }
    if (area === 'session' && changes.session && !session) {
      const tabSession = changes.session.newValue;
      setLive(Boolean(tabSession?.capturing), ENGINE_LABELS[tabSession?.engine]);
    }
  });

  window.addEventListener('beforeunload', () => session?.stop());
}

// ---------------------------------------------------------------------------
// Captura de otra ventana / pantalla
// ---------------------------------------------------------------------------
async function startCapture() {
  hideNotice();
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include'
    });
  } catch (error) {
    if (error.name !== 'NotAllowedError') showNotice('error', `No se pudo compartir: ${error.message}`);
    return;
  }

  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach((track) => track.stop());
    showNotice('warning', IS_MAC
      ? 'No llegó audio. En Mac, al compartir una ventana no se incluye su sonido: elige una pestaña de Chrome, o «Pantalla completa» con «Compartir audio del sistema» (macOS 14.2+ y Chrome 141+). Para Zoom/Teams/Meet, otra opción es abrir la reunión en el navegador y usar la fuente «Pestaña».'
      : 'No llegó audio. Elige «Pantalla completa» (o una pestaña de Chrome) y activa «Compartir también el audio del sistema»: en Windows las ventanas individuales no comparten sonido.');
    return;
  }

  session = new CaptureSession({
    stream,
    playback: false, // El audio ya suena en el sistema: reproducirlo otra vez causaría eco.
    settings,
    onCaption: (caption) => {
      renderCaption(caption);
      if (caption.complete) sendMessage({ action: 'CAPTION', caption });
    },
    onStatus: handleStatus
  });

  // Si el usuario pulsa «Dejar de compartir» en la barra de Chrome.
  stream.getVideoTracks()[0]?.addEventListener('ended', stopCapture);

  els.btnCapture.classList.add('recording');
  els.captureText.textContent = 'Iniciando…';
  try {
    await session.start();
    setLive(true, ENGINE_LABELS[session.engineId]);
    els.captureText.textContent = 'Detener escucha';
  } catch (error) {
    session = null;
    resetCaptureButton();
    showNotice('error', error.message, error.code);
  }
}

function stopCapture() {
  session?.stop();
  session = null;
  resetCaptureButton();
  setLive(false);
}

function resetCaptureButton() {
  els.btnCapture.classList.remove('recording');
  els.captureText.textContent = 'Escuchar otra ventana / app';
}

function handleStatus(status) {
  if (status.type === 'engine') setLive(true, status.label);
  else if (status.type === 'warning') showNotice('warning', status.message, status.code);
  else if (status.type === 'error') {
    stopCapture();
    if (status.error.code !== 'source-ended') showNotice('error', status.error.message, status.error.code);
  }
}

function promptCapture() {
  showNotice('info', 'Pulsa «Escuchar otra ventana / app» y elige la ventana, app o pantalla que quieres traducir.');
  els.btnCapture.classList.remove('attention');
  void els.btnCapture.offsetWidth;
  els.btnCapture.classList.add('attention');
  els.btnCapture.focus();
}

// ---------------------------------------------------------------------------
// Renderizado
// ---------------------------------------------------------------------------
function applySettings() {
  const from = getLanguage(settings.sourceLang);
  const to = getLanguage(settings.targetLang);
  const translationOnly = settings.captionMode === 'translation';
  for (const body of bodies()) body.classList.toggle('translation-only', translationOnly);
  els.modeText.textContent = translationOnly ? `Solo ${to.label.toLowerCase()}` : `Bilingüe (${from.short} + ${to.short})`;
  els.tagOriginal.textContent = from.short;
  els.tagTranslated.textContent = to.short;
  setFontSize(viewerFontSize, { save: false });
}

function setFontSize(size, { save = true } = {}) {
  viewerFontSize = clamp(size, 18, 72);
  for (const body of bodies()) body.style.setProperty('--main-size', `${viewerFontSize}px`);
  if (save) chrome.storage.local.set({ viewerFontSize });
}

function bodies() {
  return pipWindow ? [document.body, pipWindow.document.body] : [document.body];
}

function setLive(live, engineLabel) {
  els.statusIndicator.classList.toggle('live', live);
  els.statusText.textContent = live ? 'En vivo' : 'Esperando subtítulos';
  els.engineBadge.hidden = !live || !engineLabel;
  els.engineBadge.textContent = engineLabel ?? '';
}

function renderCaption(caption) {
  captions.set(caption.id, caption);
  const ids = [...captions.keys()].sort((a, b) => a - b);
  while (ids.length > 3) captions.delete(ids.shift());

  const current = captions.get(ids[ids.length - 1]);
  const previous = captions.get(current.id - 1);
  const translated = current.translationFailed ? current.original : current.translated;

  els.textPrevious.textContent = previous ? tail(previous.translated || previous.original) : '';
  els.textTranslated.textContent = translated ? tail(translated) : '…';
  els.textTranslated.classList.toggle('pending', !translated || current.translationFailed);
  els.textOriginal.textContent = tail(current.original);
  els.liveClock.textContent = formatTime(caption.ts);
}

function tail(text) {
  if (!text || text.length <= MAX_CHARS) return text || '';
  const slice = text.slice(-MAX_CHARS);
  const space = slice.indexOf(' ');
  return `…${space > 0 && space < 30 ? slice.slice(space + 1) : slice}`;
}

function renderStream(history) {
  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'stream-empty';
    empty.textContent = 'Las frases traducidas se irán acumulando aquí…';
    els.streamList.replaceChildren(empty);
    lastRenderedTs = null;
    return;
  }

  // Solo se añaden las frases nuevas; si el historial cambió por delante se redibuja.
  const lastIndex = lastRenderedTs == null ? -1 : history.findLastIndex((item) => item.ts === lastRenderedTs);
  if (lastIndex < 0) els.streamList.replaceChildren();
  for (const raw of history.slice(lastIndex + 1)) {
    const item = normalizeHistoryItem(raw);
    const row = document.createElement('div');
    row.className = 'stream-item';
    row.append(span('stream-time', item.time), span('stream-original', item.original), span('stream-translated', item.translated || '—'));
    els.streamList.append(row);
  }
  lastRenderedTs = history.at(-1).ts;
  if (els.chkAutoScroll.checked) els.streamList.scrollTop = els.streamList.scrollHeight;
}

function span(className, text) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function showNotice(level, message, code) {
  els.notice.hidden = false;
  els.notice.className = `notice ${level}`;
  els.noticeText.textContent = message;
  const needsPermission = code === 'mic-permission';
  els.noticeAction.hidden = !needsPermission;
  if (needsPermission) {
    els.noticeAction.textContent = 'Conceder permiso';
    els.noticeAction.onclick = () => sendMessage({ action: 'OPEN_PERMISSION' });
  }
}

function hideNotice() {
  els.notice.hidden = true;
}

// ---------------------------------------------------------------------------
// Pantalla completa y ventana flotante
// ---------------------------------------------------------------------------
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

async function togglePip() {
  if (pipWindow) {
    pipWindow.close();
    return;
  }
  if (!('documentPictureInPicture' in window)) {
    showNotice('info', 'Tu Chrome no admite ventanas flotantes. Puedes arrastrar esta ventana a tu segundo monitor.');
    return;
  }
  const placeholder = document.createComment('live-card');
  try {
    pipWindow = await window.documentPictureInPicture.requestWindow({ width: 640, height: 260 });
  } catch (error) {
    showNotice('error', `No se pudo abrir la ventana flotante: ${error.message}`);
    return;
  }

  const link = pipWindow.document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('viewer.css');
  pipWindow.document.head.append(link);
  pipWindow.document.body.classList.add('pip');
  els.liveCard.replaceWith(placeholder);
  pipWindow.document.body.append(els.liveCard);
  applySettings();
  els.btnPip.textContent = '📌 Volver a la ventana';

  pipWindow.addEventListener('pagehide', () => {
    placeholder.replaceWith(els.liveCard);
    pipWindow = null;
    els.btnPip.textContent = '📌 Siempre visible';
  });
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

async function exportHistory() {
  const history = await getHistory();
  if (!history.length) return flashButton(els.btnExport, 'Vacío');
  downloadText(`transcripcion-${timestampForFile()}.txt`, historyToText(history, settings));
}

async function clearHistory() {
  if (!confirm('¿Borrar toda la transcripción?')) return;
  await chrome.storage.local.set({ sessionHistory: [] });
  captions.clear();
  els.textPrevious.textContent = '';
  els.textOriginal.textContent = '';
  els.textTranslated.textContent = 'Esperando audio…';
  els.textTranslated.classList.add('pending');
}

/**
 * LiveAudio Translate · Web móvil.
 * Abre el micrófono del celular y muestra en tiempo real la traducción de lo
 * que se escucha. Reutiliza el mismo motor de la extensión (extension/lib).
 */
import { CaptionPipeline } from '../extension/lib/pipeline.js';
import { fillLanguageSelect, getLanguage } from '../extension/lib/languages.js';
import { AppError } from '../extension/lib/errors.js';
import { createLogger, getLogEntries, onLog, formatLogEntry } from '../extension/lib/log.js';

const log = createLogger('web');

const SETTINGS_KEY = 'liveaudio-web:settings';
const HISTORY_KEY = 'liveaudio-web:history';
const HISTORY_LIMIT = 300;
const MAX_CAPTION_CHARS = 220;

const DEFAULTS = Object.freeze({
  engine: 'auto',
  sourceLang: 'en',
  targetLang: 'es',
  captionMode: 'bilingual',
  fontSize: 30,
  keepAwake: true,
  showLog: false,
  deepgramApiKey: '',
  groqApiKey: ''
});

const UA = navigator.userAgent;
const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/i.test(UA);
const HAS_SPEECH = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;

const ENGINES = {
  auto: { label: 'Automático (recomendado)', hint: 'Deepgram si tienes clave; si no, el reconocimiento gratuito del navegador. Si uno falla, cambia solo.' },
  webspeech: { label: 'Navegador · gratis', hint: 'Tiempo real y sin clave. Chrome en Android, Safari en iPhone.' },
  deepgram: { label: 'Deepgram · streaming', hint: 'Tiempo real y máxima precisión, funciona en cualquier navegador. Requiere clave.' },
  groq: { label: 'Groq Whisper · por frases', hint: 'Traduce al terminar cada frase (1–3 s). Requiere clave gratuita.' }
};
const ENGINE_NAMES = { webspeech: 'Navegador', deepgram: 'Deepgram', groq: 'Groq Whisper' };

const $ = (id) => document.getElementById(id);
const els = {
  statusLine: $('statusLine'),
  langFrom: $('langFrom'),
  langTo: $('langTo'),
  btnLangs: $('btnLangs'),
  btnShare: $('btnShare'),
  btnSettings: $('btnSettings'),
  banner: $('banner'),
  bannerText: $('bannerText'),
  bannerAction: $('bannerAction'),
  bannerClose: $('bannerClose'),
  liveBadge: $('liveBadge'),
  btnFocus: $('btnFocus'),
  textPrevious: $('textPrevious'),
  textTranslated: $('textTranslated'),
  textOriginal: $('textOriginal'),
  transcriptList: $('transcriptList'),
  btnCopy: $('btnCopy'),
  btnDownload: $('btnDownload'),
  btnClear: $('btnClear'),
  btnMic: $('btnMic'),
  micLabel: $('micLabel'),
  settingsSheet: $('settingsSheet'),
  sourceLang: $('sourceLang'),
  targetLang: $('targetLang'),
  btnSwap: $('btnSwap'),
  engineList: $('engineList'),
  deepgramKey: $('deepgramKey'),
  groqKey: $('groqKey'),
  fontSize: $('fontSize'),
  fontSizeValue: $('fontSizeValue'),
  keepAwake: $('keepAwake'),
  showLog: $('showLog'),
  debugPanel: $('debugPanel'),
  debugLog: $('debugLog'),
  btnMicTest: $('btnMicTest'),
  btnCopyLog: $('btnCopyLog'),
  btnHideLog: $('btnHideLog'),
  shareSheet: $('shareSheet'),
  qr: $('qr'),
  shareUrl: $('shareUrl'),
  btnCopyLink: $('btnCopyLink'),
  btnNativeShare: $('btnNativeShare')
};

const state = {
  settings: loadSettings(),
  history: loadHistory(),
  status: 'idle', // idle | starting | listening | paused
  wantListening: false,
  pipeline: null,
  audioContext: null,
  micStream: null,
  wakeLock: null,
  engineId: null,
  captions: new Map()
};

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------
function init() {
  // ?debug en la dirección activa el registro de diagnóstico en pantalla.
  if (new URLSearchParams(location.search).has('debug')) state.settings.showLog = true;
  logEnvironment();

  fillLanguageSelect(els.sourceLang, state.settings.sourceLang);
  fillLanguageSelect(els.targetLang, state.settings.targetLang);
  renderEngineOptions();
  els.deepgramKey.value = state.settings.deepgramApiKey;
  els.groqKey.value = state.settings.groqApiKey;
  els.fontSize.value = state.settings.fontSize;
  els.keepAwake.checked = state.settings.keepAwake;
  els.showLog.checked = state.settings.showLog;
  document.querySelector(`input[name="captionMode"][value="${state.settings.captionMode}"]`).checked = true;

  applySettings();
  renderHistory();
  renderStatus();
  setupDebugPanel();
  bindEvents();
  checkEnvironment();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch((error) => log.warn('No se pudo registrar el service worker', error.message));
  }
}

function logEnvironment() {
  const { engine, sourceLang, targetLang, deepgramApiKey, groqApiKey } = state.settings;
  log.info('Web cargada', {
    navegador: UA,
    https: window.isSecureContext,
    reconocimientoDeVoz: HAS_SPEECH ? ('SpeechRecognition' in window ? 'SpeechRecognition' : 'webkitSpeechRecognition') : 'no disponible',
    getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
    plataforma: IS_IOS ? 'iOS' : IS_ANDROID ? 'Android' : 'escritorio',
    motor: engine,
    idiomas: `${sourceLang} → ${targetLang}`,
    claves: { deepgram: Boolean(deepgramApiKey), groq: Boolean(groqApiKey) }
  });
}

function checkEnvironment() {
  if (!window.isSecureContext) {
    showBanner('error', 'Para usar el micrófono abre esta página con https:// (por ejemplo, desde GitHub Pages).');
  } else if (!navigator.mediaDevices?.getUserMedia && !HAS_SPEECH) {
    showBanner('error', 'Este navegador no permite usar el micrófono. Prueba con Chrome (Android) o Safari (iPhone).');
  } else if (!HAS_SPEECH && !state.settings.deepgramApiKey && !state.settings.groqApiKey) {
    showBanner(
      'warning',
      `Este navegador no tiene reconocimiento de voz gratuito. ${IS_IOS ? 'En iPhone usa Safari' : 'Usa Chrome'} o añade una clave de Deepgram o Groq.`,
      { label: 'Ajustes', run: openSettings }
    );
  }
}

function bindEvents() {
  els.btnMic.addEventListener('click', () => {
    if (state.status === 'listening' || state.status === 'starting') stopListening();
    else startListening();
  });

  els.btnSettings.addEventListener('click', openSettings);
  els.btnLangs.addEventListener('click', openSettings);
  els.btnShare.addEventListener('click', openShare);
  els.bannerClose.addEventListener('click', hideBanner);
  els.btnFocus.addEventListener('click', toggleFocus);
  els.btnCopy.addEventListener('click', copyTranscript);
  els.btnDownload.addEventListener('click', downloadTranscript);
  els.btnClear.addEventListener('click', clearTranscript);
  els.btnCopyLink.addEventListener('click', copyLink);
  els.btnNativeShare.addEventListener('click', nativeShare);

  // Cerrar las hojas tocando fuera.
  for (const sheet of [els.settingsSheet, els.shareSheet]) {
    sheet.addEventListener('click', (event) => {
      if (event.target === sheet) sheet.close();
    });
  }
  els.settingsSheet.addEventListener('close', applyKeysFromInputs);

  els.sourceLang.addEventListener('change', () => updateSettings({ sourceLang: els.sourceLang.value }));
  els.targetLang.addEventListener('change', () => updateSettings({ targetLang: els.targetLang.value }));
  els.btnSwap.addEventListener('click', () => {
    const { sourceLang, targetLang } = state.settings;
    els.sourceLang.value = targetLang;
    els.targetLang.value = sourceLang;
    updateSettings({ sourceLang: targetLang, targetLang: sourceLang });
  });
  els.engineList.addEventListener('change', (event) => {
    if (event.target.name === 'engine') updateSettings({ engine: event.target.value });
  });
  els.fontSize.addEventListener('input', () => updateSettings({ fontSize: Number(els.fontSize.value) }, { restart: false }));
  els.showLog.addEventListener('change', () => {
    updateSettings({ showLog: els.showLog.checked }, { restart: false });
    renderDebugVisibility();
  });
  els.btnHideLog.addEventListener('click', () => {
    els.showLog.checked = false;
    updateSettings({ showLog: false }, { restart: false });
    renderDebugVisibility();
  });
  els.btnCopyLog.addEventListener('click', copyLog);
  els.btnMicTest.addEventListener('click', testMicrophone);
  els.keepAwake.addEventListener('change', () => {
    updateSettings({ keepAwake: els.keepAwake.checked }, { restart: false });
    if (state.status === 'listening') (els.keepAwake.checked ? requestWakeLock() : releaseWakeLock());
  });
  document.querySelectorAll('input[name="captionMode"]').forEach((radio) => {
    radio.addEventListener('change', () => updateSettings({ captionMode: radio.value }, { restart: false }));
  });

  document.addEventListener('visibilitychange', handleVisibility);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) document.body.classList.remove('focus');
  });
}

// ---------------------------------------------------------------------------
// Escucha
// ---------------------------------------------------------------------------
async function startListening() {
  if (state.status === 'starting' || state.status === 'listening') return;
  if (!window.isSecureContext) {
    checkEnvironment();
    return;
  }

  hideBanner();
  setStatus('starting');
  const settings = { ...state.settings };
  log.info('Botón de micrófono: empezar a escuchar', { motor: settings.engine });

  // En iPhone el audio solo se activa si se crea durante el toque del usuario.
  if (firstEngineNeedsAudio(settings)) {
    const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextImpl({ latencyHint: 'interactive' });
    state.audioContext.resume().catch(() => {});
  }

  const pipeline = new CaptionPipeline({
    settings,
    audioContext: state.audioContext,
    acquireTrack,
    releaseTrack,
    onCaption: (caption) => pipeline === state.pipeline && handleCaption(caption),
    onStatus: (status) => pipeline === state.pipeline && handlePipelineStatus(status)
  });
  state.pipeline = pipeline;

  try {
    await pipeline.start();
    if (state.pipeline !== pipeline) return; // se detuvo mientras arrancaba
    state.engineId = pipeline.engineId;
    state.wantListening = true;
    setStatus('listening');
    requestWakeLock();
  } catch (error) {
    log.error('No se pudo empezar a escuchar', { codigo: error.code, mensaje: error.message });
    if (state.pipeline !== pipeline) return;
    teardown();
    state.wantListening = false;
    setStatus('idle');
    showError(error);
  }
}

function stopListening() {
  log.info('Escucha detenida');
  state.wantListening = false;
  teardown();
  setStatus('idle');
}

function pauseListening() {
  log.info('Escucha en pausa');
  teardown();
  setStatus('paused');
}

function teardown() {
  const pipeline = state.pipeline;
  state.pipeline = null;
  pipeline?.stop();
  if (state.micStream) {
    state.micStream.getTracks().forEach((track) => track.stop());
    state.micStream = null;
  }
  if (state.audioContext && state.audioContext.state !== 'closed') state.audioContext.close().catch(() => {});
  state.audioContext = null;
  state.engineId = null;
  releaseWakeLock();
}

function firstEngineNeedsAudio(settings) {
  if (settings.engine === 'deepgram' || settings.engine === 'groq') return true;
  if (settings.engine === 'auto') return Boolean(settings.deepgramApiKey) || (!HAS_SPEECH && Boolean(settings.groqApiKey));
  return false;
}

async function acquireTrack() {
  try {
    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (error) {
    log.error('getUserMedia falló', { nombre: error.name, mensaje: error.message });
    throw micError(error);
  }
  const track = state.micStream.getAudioTracks()[0];
  log.info('Micrófono abierto con getUserMedia', { dispositivo: track.label, ajustes: track.getSettings?.() });
  track.addEventListener('ended', handleMicLost);
  return track;
}

function releaseTrack(track) {
  track.removeEventListener('ended', handleMicLost);
  track.stop();
  state.micStream = null;
}

function handleMicLost() {
  // Llamada entrante, otra app usando el micrófono, auriculares desconectados…
  log.warn('La pista del micrófono terminó');
  if (state.status !== 'listening') return;
  pauseListening();
  showBanner('warning', 'Se perdió el micrófono. Toca el botón para continuar.');
}

function handleVisibility() {
  log.info(document.hidden ? 'Página oculta (pantalla bloqueada o cambio de app)' : 'Página visible');
  if (document.hidden) {
    if (state.status === 'listening' || state.status === 'starting') pauseListening();
    return;
  }
  if (state.wantListening && state.status === 'paused') {
    startListening().then(() => {
      if (state.status !== 'listening') {
        setStatus('paused');
        state.wantListening = true;
        showBanner('info', 'Toca el micrófono para seguir escuchando.');
      }
    });
  }
}

function handlePipelineStatus(status) {
  if (status.type === 'engine') {
    state.engineId = status.engine;
    renderStatus();
  } else if (status.type === 'warning') {
    log.warn('Aviso mostrado', { codigo: status.code, mensaje: status.message });
    showBanner('warning', friendlyMessage(status));
  } else if (status.type === 'error') {
    if (document.hidden) {
      pauseListening();
      return;
    }
    stopListening();
    showError(status.error);
  }
}

function micError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return new AppError('mic-permission', 'Permiso de micrófono denegado.');
  }
  if (error.name === 'NotFoundError') return new AppError('mic-missing', 'No se encontró ningún micrófono.');
  if (error.name === 'NotReadableError') return new AppError('mic-busy', 'Otra app está usando el micrófono. Ciérrala y vuelve a intentarlo.');
  return new AppError('mic', `No se pudo abrir el micrófono: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Mensajes de error comprensibles
// ---------------------------------------------------------------------------
function showError(error) {
  log.error('Aviso de error mostrado', { codigo: error.code, mensaje: error.message });
  const action = /^(deepgram|groq)-(missing-key|auth|connect)$/.test(error.code) || error.code === 'webspeech-unavailable'
    ? { label: 'Ajustes', run: openSettings }
    : null;
  showBanner('error', friendlyMessage(error), action);
}

function friendlyMessage({ code, message }) {
  switch (code) {
    case 'mic-permission':
      if (IS_IOS) return 'Permite el micrófono: toca «aA» en la barra de Safari → Ajustes del sitio web → Micrófono → Permitir. Revisa también Ajustes → Safari → Micrófono.';
      if (IS_ANDROID) return 'Permite el micrófono: toca el icono junto a la dirección → Permisos → Micrófono → Permitir.';
      return 'Permite el micrófono desde el icono del candado en la barra de direcciones.';
    case 'webspeech-unavailable':
      return `Este navegador no tiene reconocimiento de voz gratuito. ${IS_IOS ? 'En iPhone usa Safari' : 'Usa Google Chrome'} o añade una clave de Deepgram o Groq en Ajustes.`;
    case 'webspeech-blocked':
      return IS_IOS
        ? 'Activa Dictado en Ajustes → General → Teclado → Activar Dictado, y vuelve a intentarlo.'
        : 'El reconocimiento de voz está desactivado en este navegador. Prueba con Google Chrome o usa una clave de Deepgram.';
    default:
      return message;
  }
}

// ---------------------------------------------------------------------------
// Subtítulos
// ---------------------------------------------------------------------------
function handleCaption(caption) {
  state.captions.set(caption.id, caption);
  const ids = [...state.captions.keys()].sort((a, b) => a - b);
  while (ids.length > 3) state.captions.delete(ids.shift());

  const current = state.captions.get(ids[ids.length - 1]);
  const previous = state.captions.get(current.id - 1);
  const translated = current.translationFailed ? current.original : current.translated;

  els.textPrevious.textContent = previous ? tail(previous.translated || previous.original) : '';
  els.textTranslated.textContent = translated ? tail(translated) : '…';
  els.textTranslated.classList.toggle('pending', !translated);
  els.textOriginal.textContent = tail(current.original);

  if (caption.complete) {
    addHistory({ original: caption.original, translated: caption.translationFailed ? '' : caption.translated, ts: caption.ts });
  }
}

function tail(text) {
  if (!text || text.length <= MAX_CAPTION_CHARS) return text || '';
  const slice = text.slice(-MAX_CAPTION_CHARS);
  const space = slice.indexOf(' ');
  return `…${space > 0 && space < 30 ? slice.slice(space + 1) : slice}`;
}

function resetCaptions() {
  state.captions.clear();
  els.textPrevious.textContent = '';
  els.textOriginal.textContent = '';
  els.textTranslated.textContent = placeholderText();
  els.textTranslated.classList.add('pending');
}

function placeholderText() {
  const from = getLanguage(state.settings.sourceLang).label.toLowerCase();
  return `Toca el micrófono y acerca el celular a quien habla en ${from}.`;
}

// ---------------------------------------------------------------------------
// Estado visual
// ---------------------------------------------------------------------------
function setStatus(status) {
  if (state.status !== status) log.debug(`Estado: ${state.status} → ${status}`);
  state.status = status;
  renderStatus();
}

function renderStatus() {
  const { status } = state;
  const listening = status === 'listening';
  els.btnMic.classList.toggle('listening', listening);
  els.btnMic.classList.toggle('starting', status === 'starting');
  els.btnMic.setAttribute('aria-label', listening ? 'Detener' : 'Empezar a escuchar');
  els.micLabel.textContent = {
    idle: 'Toca para escuchar',
    starting: 'Abriendo micrófono…',
    listening: 'Toca para detener',
    paused: 'Toca para continuar'
  }[status];

  els.liveBadge.classList.toggle('live', listening);
  els.liveBadge.textContent = listening ? 'En vivo' : status === 'starting' ? 'Iniciando' : 'En pausa';

  els.statusLine.classList.toggle('live', listening);
  els.statusLine.textContent = listening
    ? `Escuchando · ${ENGINE_NAMES[state.engineId] ?? ''}`.replace(/ · $/, '')
    : status === 'paused' ? 'En pausa' : status === 'starting' ? 'Iniciando…' : 'Listo para escuchar';
}

let bannerAction = null;
function showBanner(level, message, action = null) {
  els.banner.hidden = false;
  els.banner.className = `banner ${level}`;
  els.bannerText.textContent = message;
  bannerAction = action;
  els.bannerAction.hidden = !action;
  if (action) els.bannerAction.textContent = action.label;
}
els.bannerAction.addEventListener('click', () => bannerAction?.run());

function hideBanner() {
  els.banner.hidden = true;
}

async function toggleFocus() {
  const focused = document.body.classList.toggle('focus');
  try {
    if (focused && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else if (!focused && document.fullscreenElement) await document.exitFullscreen();
  } catch { /* iPhone no permite pantalla completa en páginas: queda el modo enfoque */ }
}

async function requestWakeLock() {
  if (!state.settings.keepAwake || !('wakeLock' in navigator) || document.hidden || state.wakeLock) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
    log.debug('Pantalla encendida (wake lock activo)');
  } catch (error) {
    log.debug('No se pudo mantener la pantalla encendida', error.message);
  }
}

function releaseWakeLock() {
  state.wakeLock?.release().catch(() => {});
  state.wakeLock = null;
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------
function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    const settings = { ...DEFAULTS, ...stored };
    if (!ENGINES[settings.engine]) settings.engine = DEFAULTS.engine;
    return settings;
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch { /* almacenamiento no disponible (modo privado) */ }
}

function updateSettings(patch, { restart = true } = {}) {
  Object.assign(state.settings, patch);
  saveSettings();
  applySettings();
  // Idioma, motor o claves nuevos: se reinicia la escucha para aplicarlos.
  if (restart && state.status === 'listening') {
    teardown();
    setStatus('idle');
    startListening();
  }
}

function applyKeysFromInputs() {
  const deepgramApiKey = els.deepgramKey.value.trim();
  const groqApiKey = els.groqKey.value.trim();
  if (deepgramApiKey !== state.settings.deepgramApiKey || groqApiKey !== state.settings.groqApiKey) {
    updateSettings({ deepgramApiKey, groqApiKey });
    renderEngineOptions();
  }
}

function applySettings() {
  const { sourceLang, targetLang, fontSize, captionMode } = state.settings;
  const from = getLanguage(sourceLang);
  const to = getLanguage(targetLang);
  els.langFrom.textContent = from.short;
  els.langTo.textContent = to.short;
  document.title = `LiveAudio Translate · ${from.label} → ${to.label}`;
  document.documentElement.style.setProperty('--caption-size', `${fontSize}px`);
  els.fontSizeValue.textContent = `${fontSize}px`;
  document.body.classList.toggle('translation-only', captionMode === 'translation');
  if (!state.captions.size) resetCaptions();
}

function renderEngineOptions() {
  els.engineList.replaceChildren(
    ...Object.entries(ENGINES).map(([id, info]) => {
      const label = document.createElement('label');
      label.className = 'engine-option';
      const input = Object.assign(document.createElement('input'), {
        type: 'radio',
        name: 'engine',
        value: id,
        checked: state.settings.engine === id
      });
      const text = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = info.label;
      const hint = document.createElement('span');
      hint.textContent = id === 'webspeech' && !HAS_SPEECH ? 'No disponible en este navegador.' : info.hint;
      if (id === 'webspeech' && !HAS_SPEECH) label.classList.add('unavailable');
      text.append(title, hint);
      label.append(input, text);
      return label;
    })
  );
}

function openSettings() {
  if (!els.settingsSheet.open) els.settingsSheet.showModal();
}

// ---------------------------------------------------------------------------
// Transcripción
// ---------------------------------------------------------------------------
function loadHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(-HISTORY_LIMIT)));
  } catch { /* sin almacenamiento */ }
}

function addHistory(item) {
  state.history.push(item);
  if (state.history.length > HISTORY_LIMIT) {
    state.history.shift();
    els.transcriptList.firstElementChild?.remove();
  }
  saveHistory();
  els.transcriptList.querySelector('.transcript-empty')?.remove();
  const list = els.transcriptList;
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.append(historyRow(item));
  if (nearBottom) list.scrollTop = list.scrollHeight;
}

function renderHistory() {
  if (!state.history.length) {
    const empty = document.createElement('li');
    empty.className = 'transcript-empty';
    empty.textContent = 'Aquí se irán guardando las frases traducidas.';
    els.transcriptList.replaceChildren(empty);
    return;
  }
  els.transcriptList.replaceChildren(...state.history.map(historyRow));
  els.transcriptList.scrollTop = els.transcriptList.scrollHeight;
}

function historyRow(item) {
  const li = document.createElement('li');
  const time = document.createElement('span');
  time.className = 't-time';
  time.textContent = formatTime(item.ts);
  const original = document.createElement('span');
  original.className = 't-original';
  original.textContent = item.original;
  const translated = document.createElement('span');
  translated.className = 't-translated';
  translated.textContent = item.translated || '—';
  li.append(time, original, translated);
  return li;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function transcriptText() {
  const from = getLanguage(state.settings.sourceLang).short;
  const to = getLanguage(state.settings.targetLang).short;
  return state.history
    .map((item) => `[${formatTime(item.ts)}]\n${from}: ${item.original}\n${to}: ${item.translated || '—'}\n`)
    .join('\n');
}

async function copyTranscript() {
  if (!state.history.length) return flash(els.btnCopy, 'Vacía');
  try {
    await navigator.clipboard.writeText(transcriptText());
    flash(els.btnCopy, '✓ Copiada');
  } catch {
    flash(els.btnCopy, 'No se pudo');
  }
}

function downloadTranscript() {
  if (!state.history.length) return flash(els.btnDownload, 'Vacía');
  const url = URL.createObjectURL(new Blob([transcriptText()], { type: 'text/plain;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: `transcripcion-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function clearTranscript() {
  if (!state.history.length || !confirm('¿Borrar toda la transcripción?')) return;
  state.history = [];
  saveHistory();
  renderHistory();
  resetCaptions();
}

async function flash(button, text) {
  const original = button.textContent;
  button.textContent = text;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  button.textContent = original;
}

// ---------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------
const MAX_LOG_LINES = 400;

function setupDebugPanel() {
  for (const entry of getLogEntries()) appendLogLine(entry);
  onLog(appendLogLine);
  renderDebugVisibility();
}

function renderDebugVisibility() {
  els.debugPanel.hidden = !state.settings.showLog;
  if (state.settings.showLog) els.debugLog.scrollTop = els.debugLog.scrollHeight;
}

function appendLogLine(entry) {
  const line = document.createElement('div');
  line.className = entry.level;
  line.textContent = formatLogEntry(entry);
  const nearBottom = els.debugLog.scrollHeight - els.debugLog.scrollTop - els.debugLog.clientHeight < 40;
  els.debugLog.append(line);
  while (els.debugLog.childElementCount > MAX_LOG_LINES) els.debugLog.firstElementChild.remove();
  if (nearBottom) els.debugLog.scrollTop = els.debugLog.scrollHeight;
}

async function copyLog() {
  try {
    await navigator.clipboard.writeText(getLogEntries().map(formatLogEntry).join('\n'));
    flash(els.btnCopyLog, '✓ Copiado');
  } catch {
    flash(els.btnCopyLog, 'No se pudo');
  }
}

/**
 * Abre el micrófono 5 segundos y registra qué dispositivo usa el navegador y
 * cuánto sonido llega. Sirve para saber si el problema es el micrófono.
 */
async function testMicrophone() {
  if (state.status === 'listening' || state.status === 'starting') {
    log.warn('Detén la escucha antes de probar el micrófono');
    return;
  }
  els.btnMicTest.disabled = true;
  log.info('Prueba de micrófono: habla durante 5 segundos…');
  let stream;
  let context;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = stream.getAudioTracks()[0];
    log.info('Dispositivo usado', { nombre: track.label, ajustes: track.getSettings?.() });

    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    log.info('Entradas de audio disponibles', inputs.map((d) => `${d.deviceId === 'default' ? '[predeterminada] ' : ''}${d.label || '(sin nombre)'}`));

    const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
    context = new AudioContextImpl();
    await context.resume().catch(() => {});
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    let peakDb = -Infinity;
    for (let second = 1; second <= 5; second++) {
      let secondPeak = 0;
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) sum += value * value;
        secondPeak = Math.max(secondPeak, Math.sqrt(sum / samples.length));
      }
      const db = secondPeak > 0 ? 20 * Math.log10(secondPeak) : -100;
      peakDb = Math.max(peakDb, db);
      const bars = '█'.repeat(Math.max(0, Math.min(20, Math.round((db + 70) / 3))));
      log.info(`Nivel ${second}/5: ${db.toFixed(0)} dB ${bars}`);
    }

    if (peakDb < -55) {
      log.error('No llega sonido del micrófono. Revisa la entrada de audio del sistema (en Mac: Ajustes del Sistema → Sonido → Entrada) y que no esté silenciado.');
    } else if (peakDb < -40) {
      log.warn('Llega muy poco sonido. Acerca el micrófono o sube el volumen de entrada.');
    } else {
      log.info('El micrófono funciona: llega sonido correctamente.');
    }
  } catch (error) {
    log.error('La prueba de micrófono falló', { nombre: error.name, mensaje: error.message });
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    context?.close().catch(() => {});
    els.btnMicTest.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Compartir
// ---------------------------------------------------------------------------
function shareLink() {
  return `${location.origin}${location.pathname}`;
}

function openShare() {
  const url = shareLink();
  els.shareUrl.textContent = url;
  els.btnNativeShare.hidden = !navigator.share;
  if (typeof window.qrcode === 'function') {
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    els.qr.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    els.qr.hidden = false;
  } else {
    els.qr.hidden = true;
  }
  els.shareSheet.showModal();
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareLink());
    flash(els.btnCopyLink, '✓ Copiado');
  } catch {
    flash(els.btnCopyLink, 'No se pudo');
  }
}

async function nativeShare() {
  try {
    await navigator.share({ title: 'LiveAudio Translate', text: 'Traducción en vivo desde tu celular', url: shareLink() });
  } catch { /* el usuario canceló */ }
}

// Se inicia al final, cuando ya están declaradas todas las constantes del módulo.
init();

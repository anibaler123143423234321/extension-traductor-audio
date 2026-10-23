/**
 * LiveAudio Translate - Service worker (Manifest V3).
 * Gestiona la sesión de captura, el documento offscreen, el historial y
 * el reenvío de subtítulos a la pestaña. El estado vive en chrome.storage.session
 * para sobrevivir a que Chrome suspenda el service worker.
 */
import { loadSettings } from './lib/settings.js';
import { AppError, serializeError } from './lib/errors.js';

const OFFSCREEN_URL = 'offscreen.html';
const VIEWER_URL = 'viewer.html';
const HISTORY_LIMIT = 300;
const IDLE_SESSION = Object.freeze({
  capturing: false,
  tabId: null,
  tabTitle: '',
  source: null,
  engine: null,
  startedAt: 0
});

let sessionCache = null;
let creatingOffscreen = null;
let historyBuffer = [];
let historyTimer = null;

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
async function getSession() {
  if (!sessionCache) {
    const { session } = await chrome.storage.session.get('session');
    sessionCache = { ...IDLE_SESSION, ...session };
  }
  return sessionCache;
}

async function setSession(patch) {
  sessionCache = { ...(await getSession()), ...patch };
  await chrome.storage.session.set({ session: sessionCache });
  return sessionCache;
}

async function setNotice(notice) {
  await chrome.storage.session.set({ notice: notice ? { ...notice, at: Date.now() } : null });
}

async function getStatus() {
  let session = await getSession();
  // Si Chrome cerró el offscreen (p. ej. tras actualizar la extensión), la sesión ya no existe.
  if (session.capturing && !(await hasOffscreen())) {
    session = await setSession({ ...IDLE_SESSION });
    updateBadge(false);
  }
  const { notice } = await chrome.storage.session.get('notice');
  return { ...session, notice: notice ?? null };
}

function updateBadge(capturing, error = false) {
  chrome.action.setBadgeText({ text: error ? '!' : capturing ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: error ? '#e11d48' : '#10b981' });
}

// ---------------------------------------------------------------------------
// Documento offscreen
// ---------------------------------------------------------------------------
async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA'],
      justification: 'Captura el audio de la pestaña o del micrófono para transcribirlo y traducirlo en tiempo real.'
    })
    .finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

async function closeOffscreen() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {});
}

// ---------------------------------------------------------------------------
// Sesión de captura
// ---------------------------------------------------------------------------
const RESTRICTED_URL = /^(chrome|edge|brave|opera|vivaldi|about|chrome-extension|devtools|view-source|chrome-search):|^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i;

async function startSession({ tabId, tabTitle = '', source = 'tab' }) {
  if (source !== 'tab' && source !== 'mic') {
    throw new AppError('invalid-source', 'Para capturar otra ventana usa la ventana de "Segundo monitor".');
  }
  if ((await getSession()).capturing) await stopSession();
  await setNotice(null);

  const settings = await loadSettings();
  const tab = await chrome.tabs.get(tabId);

  let streamId;
  if (source === 'tab') {
    if (!tab.url || RESTRICTED_URL.test(tab.url)) {
      throw new AppError(
        'restricted-page',
        'Chrome no permite capturar esta página. Abre el video o la reunión en una pestaña normal (http/https).'
      );
    }
    streamId = await getTabStreamId(tabId);
  }

  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({ target: 'offscreen', action: 'START', source, streamId, settings });
  if (!response?.ok) {
    await closeOffscreen();
    const error = response?.error ?? { code: 'offscreen', message: 'No se pudo iniciar la captura de audio.' };
    await setNotice({ level: 'error', ...error });
    updateBadge(false, true);
    return { ok: false, error };
  }

  await setSession({
    capturing: true,
    tabId,
    tabTitle: tabTitle || tab.title || '',
    source,
    engine: response.engine,
    startedAt: Date.now()
  });
  updateBadge(true);
  await showOverlay(tabId);
  return { ok: true, engine: response.engine };
}

async function getTabStreamId(tabId) {
  try {
    return await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/active stream/i.test(message)) {
      throw new AppError('tab-busy', 'Esta pestaña ya se está capturando. Detén la otra captura o recarga la pestaña.');
    }
    if (/invoked|activeTab/i.test(message)) {
      throw new AppError('not-invoked', 'Abre la extensión desde la pestaña que quieres traducir y vuelve a intentarlo.');
    }
    throw new AppError('tab-capture', `No se pudo capturar el audio de la pestaña: ${message}`);
  }
}

async function stopSession() {
  await chrome.runtime.sendMessage({ target: 'offscreen', action: 'STOP' }).catch(() => {});
  await closeOffscreen();
  const { tabId } = await getSession();
  if (tabId) chrome.tabs.sendMessage(tabId, { action: 'OVERLAY_HIDE' }).catch(() => {});
  await setSession({ ...IDLE_SESSION });
  updateBadge(false);
  return { ok: true };
}

async function showOverlay(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'OVERLAY_SHOW' });
  } catch {
    // La pestaña aún no tiene el script: se inyecta (falla en páginas internas, sin problema).
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { action: 'OVERLAY_SHOW' });
    } catch { /* página sin acceso */ }
  }
}

async function handleEngineStatus(status) {
  if (status.type === 'engine') {
    await setSession({ engine: status.engine });
  } else if (status.type === 'warning') {
    await setNotice({ level: 'warning', code: status.code, message: status.message });
  } else if (status.type === 'error') {
    await stopSession();
    await setNotice({ level: 'error', ...status.error });
    updateBadge(false, true);
  }
}

// ---------------------------------------------------------------------------
// Subtítulos e historial
// ---------------------------------------------------------------------------
async function handleCaption(caption, fromOffscreen) {
  if (fromOffscreen) {
    const { tabId, capturing } = await getSession();
    if (capturing && tabId) chrome.tabs.sendMessage(tabId, { action: 'OVERLAY_CAPTION', caption }).catch(() => {});
  }
  if (caption.complete) queueHistory(caption);
}

function queueHistory(caption) {
  historyBuffer.push({
    original: caption.original,
    translated: caption.translationFailed ? '' : caption.translated,
    ts: caption.ts
  });
  clearTimeout(historyTimer);
  historyTimer = setTimeout(flushHistory, 400);
}

async function flushHistory() {
  const items = historyBuffer;
  historyBuffer = [];
  if (!items.length) return;
  const { sessionHistory = [] } = await chrome.storage.local.get('sessionHistory');
  await chrome.storage.local.set({ sessionHistory: [...sessionHistory, ...items].slice(-HISTORY_LIMIT) });
}

// ---------------------------------------------------------------------------
// Ventanas auxiliares
// ---------------------------------------------------------------------------
async function openViewer({ capture = false } = {}) {
  const url = chrome.runtime.getURL(VIEWER_URL);
  const existing = (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith(url));
  if (existing) {
    await chrome.windows.update(existing.windowId, { focused: true });
    if (capture) chrome.tabs.sendMessage(existing.id, { action: 'VIEWER_PROMPT_CAPTURE' }).catch(() => {});
    return { ok: true };
  }
  await chrome.windows.create({
    url: capture ? `${url}?capture=1` : url,
    type: 'popup',
    width: 780,
    height: 560,
    focused: true
  });
  return { ok: true };
}

async function openPermissionPage() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Mensajes y eventos
// ---------------------------------------------------------------------------
const handlers = {
  GET_STATUS: () => getStatus(),
  START_SESSION: (message) =>
    startSession(message).catch(async (error) => {
      await setNotice({ level: 'error', ...serializeError(error) });
      updateBadge(false, true);
      throw error;
    }),
  STOP_SESSION: () => stopSession(),
  OPEN_VIEWER: (message) => openViewer(message),
  OPEN_PERMISSION: () => openPermissionPage(),
  CLEAR_NOTICE: () => setNotice(null),
  MIC_PERMISSION_GRANTED: () => setNotice({ level: 'info', message: 'Permiso concedido. Ya puedes iniciar la traducción.' }),
  CAPTION: (message, sender) => handleCaption(message.caption, isOffscreen(sender)),
  ENGINE_STATUS: (message, sender) => (isOffscreen(sender) ? handleEngineStatus(message.status) : undefined),
  OVERLAY_STATE: async (message, sender) => {
    const { capturing, tabId } = await getSession();
    return { visible: capturing && tabId === sender.tab?.id };
  }
};

function isOffscreen(sender) {
  return sender.url === chrome.runtime.getURL(OFFSCREEN_URL);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'offscreen') return false;
  const handler = handlers[message?.action];
  if (!handler) return false;

  Promise.resolve()
    .then(() => handler(message, sender))
    .then(
      (result) => sendResponse(result ?? { ok: true }),
      (error) => {
        console.error('[LiveAudio]', error);
        sendResponse({ ok: false, error: serializeError(error) });
      }
    );
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSession();
  if (session.capturing && session.tabId === tabId) await stopSession();
});

// Al navegar dentro de la pestaña capturada se vuelve a mostrar el subtítulo.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const session = await getSession();
  if (session.capturing && session.tabId === tabId) await showOverlay(tabId);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-caption') return;
  const activeTab = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!activeTab) return;

  const session = await getSession();
  if (session.capturing && session.tabId === activeTab.id) {
    await stopSession();
    return;
  }
  try {
    const { source } = await loadSettings();
    await startSession({ tabId: activeTab.id, tabTitle: activeTab.title, source: source === 'mic' ? 'mic' : 'tab' });
  } catch (error) {
    await setNotice({ level: 'error', ...serializeError(error) });
    updateBadge(false, true);
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session.set({ session: { ...IDLE_SESSION }, notice: null });
  updateBadge(false);
});

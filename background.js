/**
 * LiveAudio Translate - Background Service Worker (Manifest V3)
 * Administra el estado de captura de la pestaña, el documento offscreen y el enrutamiento de subtítulos.
 */

let currentSession = {
  isCapturing: false,
  tabId: null,
  tabTitle: ''
};

// Crear o verificar el documento Offscreen necesario para procesar audio en MV3
async function ensureOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('offscreen.html')]
    });
    if (contexts.length > 0) return;
  } else {
    try {
      const response = await chrome.runtime.sendMessage({ target: 'offscreen', action: 'PING' });
      if (response && response.alive) return;
    } catch (e) {}
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Captura el flujo de audio de la pestaña web para procesar transcripción y traducción en tiempo real.'
  });
}

// Iniciar captura en una pestaña específica
async function startCapture(tabId, tabTitle = '') {
  try {
    const settings = await chrome.storage.local.get([
      'groqApiKey',
      'chunkInterval',
      'captionMode'
    ]);

    const apiKey = settings.groqApiKey;
    
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Falta ingresar tu API Key gratuita de Groq (gsk_...). Abre la extensión para configurarla.');
    }

    // 1. Obtener streamId de tabCapture
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    if (!streamId) {
      throw new Error('No se pudo obtener el flujo de audio de la pestaña actual.');
    }

    // 2. Asegurar que el documento offscreen esté listo
    await ensureOffscreenDocument();

    // 3. Notificar a offscreen para que empiece a grabar y reproducir
   await chrome.runtime.sendMessage({
  target: 'offscreen',
  action: 'START_CAPTURE',
  streamId: streamId,
  tabId: tabId,
  apiKey: apiKey,
  chunkInterval: settings.chunkInterval || 3500,
  captionMode: settings.captionMode || 'bilingual'
});
    currentSession = {
      isCapturing: true,
      tabId: tabId,
      tabTitle: tabTitle
    };

    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });

    // Avisar al script de contenido de la pestaña que muestre la caja flotante
    chrome.tabs.sendMessage(tabId, { action: 'SHOW_OVERLAY' }).catch(() => {
      chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] }).catch(() => {});
      chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).then(() => {
        chrome.tabs.sendMessage(tabId, { action: 'SHOW_OVERLAY' }).catch(() => {});
      }).catch(() => {});
    });

    return { success: true };
  } catch (error) {
    console.error('[LiveAudio Background] Error al iniciar captura:', error);
    return { success: false, error: error.message };
  }
}

// Detener captura actual
async function stopCapture() {
  try {
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'STOP_CAPTURE'
    }).catch(() => {});

    if (currentSession.tabId) {
      chrome.tabs.sendMessage(currentSession.tabId, { action: 'HIDE_OVERLAY' }).catch(() => {});
    }

    currentSession = {
      isCapturing: false,
      tabId: null,
      tabTitle: ''
    };

    chrome.action.setBadgeText({ text: '' });
    return { success: true };
  } catch (error) {
    console.error('[LiveAudio Background] Error al detener captura:', error);
    return { success: false, error: error.message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'GET_STATUS') {
    sendResponse({
      isCapturing: currentSession.isCapturing,
      tabId: currentSession.tabId,
      tabTitle: currentSession.tabTitle
    });
    return true;
  }

  if (message.action === 'START_SESSION') {
    startCapture(message.tabId, message.tabTitle).then(sendResponse);
    return true;
  }

  if (message.action === 'STOP_SESSION') {
    stopCapture().then(sendResponse);
    return true;
  }

  if (message.action === 'OPEN_VIEWER_WINDOW') {
    chrome.windows.create({
      url: chrome.runtime.getURL('viewer.html'),
      type: 'popup',
      width: 720,
      height: 540,
      focused: true
    }).then(win => {
      sendResponse({ success: true, windowId: win.id });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (message.action === 'NEW_TRANSCRIPTION') {
    const { tabId, english, spanish, timestamp } = message;

    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: 'UPDATE_SUBTITLE',
        english: english,
        spanish: spanish,
        timestamp: timestamp
      }).catch(() => {});
    }

    chrome.storage.local.get(['sessionHistory'], (res) => {
      const history = res.sessionHistory || [];
      history.push({
        english,
        spanish,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      });
      if (history.length > 100) history.shift();
      chrome.storage.local.set({ sessionHistory: history });
    });

    return false;
  }

  if (message.action === 'OFFSCREEN_ERROR') {
    console.error('[LiveAudio Offscreen Error]:', message.error);
    stopCapture();
    return false;
  }
});

chrome.tabs.onRemoved.addListener((closedTabId) => {
  if (currentSession.isCapturing && currentSession.tabId === closedTabId) {
    stopCapture();
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-caption') {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;

    if (currentSession.isCapturing && currentSession.tabId === activeTab.id) {
      await stopCapture();
    } else {
      await startCapture(activeTab.id, activeTab.title);
    }
  }
});

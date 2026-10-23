/**
 * LiveAudio Translate - Documento offscreen.
 * Obtiene el audio (pestaña o micrófono) y ejecuta el pipeline de subtítulos.
 */
import { CaptureSession } from './lib/capture-session.js';
import { AppError, serializeError } from './lib/errors.js';

let session = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;

  if (message.action === 'START') {
    start(message).then(sendResponse, (error) => sendResponse({ ok: false, error: serializeError(error) }));
    return true;
  }
  if (message.action === 'STOP') {
    stop();
    sendResponse({ ok: true });
  }
  return false;
});

async function start({ source, streamId, settings }) {
  stop();
  const stream = await getStream(source, streamId);

  session = new CaptureSession({
    stream,
    playback: source === 'tab',
    settings,
    onCaption: (caption) => chrome.runtime.sendMessage({ action: 'CAPTION', caption }).catch(() => {}),
    onStatus: (status) => chrome.runtime.sendMessage({ action: 'ENGINE_STATUS', status }).catch(() => {})
  });

  try {
    await session.start();
  } catch (error) {
    session = null;
    throw error;
  }
  return { ok: true, engine: session.engineId };
}

function stop() {
  session?.stop();
  session = null;
}

async function getStream(source, streamId) {
  try {
    if (source === 'tab') {
      return await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
        video: false
      });
    }
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
  } catch (error) {
    if (source === 'mic' && error.name === 'NotAllowedError') {
      throw new AppError('mic-permission', 'Concede permiso de micrófono a la extensión para usar esta fuente.');
    }
    if (source === 'mic' && error.name === 'NotFoundError') {
      throw new AppError('mic-missing', 'No se encontró ningún micrófono.');
    }
    throw new AppError('capture', `No se pudo acceder al audio: ${error.message}`, { cause: error });
  }
}

/**
 * LiveAudio Translate - Offscreen Document Script
 * Captura el audio de la pestaña mediante WebRTC / getUserMedia,
 * lo mantiene audible para el usuario y procesa transcripción y traducción con:
 * Groq Whisper Turbo (Gratis en Groq Cloud) + Google Translate API Gratuito (sin clave)
 */

let mediaStream = null;
let audioContext = null;
let analyser = null;
let isRecording = false;
let currentTabId = null;
let currentApiKey = null;
let currentChunkInterval = 3500;
let activeRecorder = null;

// Escuchar comandos enviados desde el background worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  if (message.action === 'PING') {
    sendResponse({ alive: true });
    return true;
  }

  if (message.action === 'START_CAPTURE') {
    startCapture(message).then(sendResponse);
    return true;
  }

  if (message.action === 'STOP_CAPTURE') {
    stopCapture();
    sendResponse({ success: true });
    return true;
  }
});

async function startCapture(config) {
  try {
    stopCapture(); // Limpiar sesión anterior si existía

    currentTabId = config.tabId;
    currentApiKey = config.apiKey;
    currentChunkInterval = Math.max(2000, Math.min(8000, config.chunkInterval || 3500));

    // 1. Obtener flujo de audio de la pestaña con tabCapture streamId
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: config.streamId
        }
      },
      video: false
    });

    // 2. Enlazar audio a altavoces/auriculares del usuario para no silenciar la pestaña
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const sourceNode = audioContext.createMediaStreamSource(mediaStream);
    sourceNode.connect(audioContext.destination);

    // 3. Analizador de volumen para omitir pausas y silencios
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    sourceNode.connect(analyser);

    isRecording = true;
    console.log('[LiveAudio Offscreen] Captura iniciada con Groq Whisper Turbo.');

    scheduleNextChunk();

    return { success: true };
  } catch (error) {
    console.error('[LiveAudio Offscreen] Error al inicializar audio:', error);
    chrome.runtime.sendMessage({
      action: 'OFFSCREEN_ERROR',
      error: 'Error de acceso al audio: ' + error.message
    });
    return { success: false, error: error.message };
  }
}

function stopCapture() {
  isRecording = false;

  if (activeRecorder && activeRecorder.state !== 'inactive') {
    try { activeRecorder.stop(); } catch (e) {}
    activeRecorder = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  if (audioContext && audioContext.state !== 'closed') {
    try { audioContext.close(); } catch (e) {}
    audioContext = null;
  }

  analyser = null;
  console.log('[LiveAudio Offscreen] Captura detenida.');
}

function scheduleNextChunk() {
  if (!isRecording || !mediaStream) return;

  let chunks = [];
  let maxVolume = 0;
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  const volumeSampler = setInterval(() => {
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const avg = sum / dataArray.length;
    if (avg > maxVolume) maxVolume = avg;
  }, 100);

  let mimeType = 'audio/webm;codecs=opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'audio/webm';
  }

  try {
    activeRecorder = new MediaRecorder(mediaStream, { mimeType: mimeType });
  } catch (err) {
    console.error('Error instanciando MediaRecorder:', err);
    return;
  }

  activeRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  activeRecorder.onstop = async () => {
    clearInterval(volumeSampler);

    if (isRecording) {
      setTimeout(scheduleNextChunk, 50);
    }

    // Solo procesar si el volumen superó el umbral de silencio
    if (chunks.length > 0 && maxVolume > 1.5) {
      const audioBlob = new Blob(chunks, { type: mimeType });
      processAudioWithGroq(audioBlob);
    }
  };

  activeRecorder.start();

  setTimeout(() => {
    if (activeRecorder && activeRecorder.state === 'recording') {
      try { activeRecorder.stop(); } catch (e) {}
    }
  }, currentChunkInterval);
}

// -------------------------------------------------------------------------
// MOTOR DE TRANSCRIPCIÓN: Groq Whisper Turbo + Google Translate Gratuito (Sin Clave)
// -------------------------------------------------------------------------
async function processAudioWithGroq(audioBlob) {
  try {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('language', 'en');
    formData.append('response_format', 'json');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${currentApiKey}`
      },
      body: formData
    });

    if (!res.ok) {
      console.warn('[Groq API Error]', await res.text());
      return;
    }

    const data = await res.json();
    const english = (data.text || '').trim();

    if (!english) return;

    // Traducir al español usando el endpoint público gratuito de Google Translate (sin clave)
    const spanish = await translateWithGoogleFree(english);

    emitTranscription(english, spanish || english);
  } catch (error) {
    console.warn('[LiveAudio Groq Error]', error);
  }
}

// Traductor gratuito de Google (sin API key)
async function translateWithGoogleFree(text) {
  if (!text || !text.trim()) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) return '';
    const data = await res.json();
    if (data && data[0]) {
      return data[0].map(item => item[0]).join('');
    }
  } catch (err) {
    console.warn('Error en Google Translate Free:', err);
  }
  return '';
}

function emitTranscription(english, spanish) {
  chrome.runtime.sendMessage({
    action: 'NEW_TRANSCRIPTION',
    tabId: currentTabId,
    english: english,
    spanish: spanish,
    timestamp: Date.now()
  });
}

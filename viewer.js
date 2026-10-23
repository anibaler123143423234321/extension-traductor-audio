/**
 * LiveAudio Translate - Viewer Controller (Segundo Monitor / Ventana Independiente)
 * Muestra las traducciones en tiempo real y permite capturar audio de otra ventana (Zoom, Meet, reproductor, etc.)
 */

document.addEventListener('DOMContentLoaded', async () => {
  const textEs = document.getElementById('textEs');
  const textEn = document.getElementById('textEn');
  const liveClock = document.getElementById('liveClock');
  const streamList = document.getElementById('streamList');
  const providerBadge = document.getElementById('providerBadge');
  const connectionStatus = document.getElementById('connectionStatus');

  const btnCaptureDesktop = document.getElementById('btnCaptureDesktop');
  const desktopBtnText = document.getElementById('desktopBtnText');
  const btnToggleMode = document.getElementById('btnToggleMode');
  const modeText = document.getElementById('modeText');
  const btnFontInc = document.getElementById('btnFontInc');
  const btnFontDec = document.getElementById('btnFontDec');
  const btnPip = document.getElementById('btnPip');
  const btnFullscreen = document.getElementById('btnFullscreen');
  const chkAutoScroll = document.getElementById('chkAutoScroll');

  const btnCopyStream = document.getElementById('btnCopyStream');
  const btnExportStream = document.getElementById('btnExportStream');
  const btnClearStream = document.getElementById('btnClearStream');

  let currentMainSize = 26;
  let isBilingual = true;

  // Variables para captura local de otra ventana / Zoom
  let isDesktopCapturing = false;
  let desktopMediaStream = null;
  let desktopAudioContext = null;
  let desktopAnalyser = null;
  let desktopRecorder = null;

  // 1. Cargar configuración inicial
  const stored = await chrome.storage.local.get([
    'sessionHistory',
    'groqApiKey',
    'captionMode'
  ]);
  
  providerBadge.textContent = 'Groq Whisper Turbo';

  if (stored.captionMode === 'spanish') {
    isBilingual = false;
    document.body.classList.add('spanish-only');
    modeText.textContent = 'Solo Español';
  }

  // 2. Renderizar historial previo si existe
  if (stored.sessionHistory && stored.sessionHistory.length > 0) {
    const lastItem = stored.sessionHistory[stored.sessionHistory.length - 1];
    updateLiveCard(lastItem.english, lastItem.spanish, lastItem.time);
    renderFullStream(stored.sessionHistory);
  }

  // 3. Escuchar nuevos subtítulos enviados desde el background (cuando se captura pestaña)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'NEW_TRANSCRIPTION') {
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      updateLiveCard(message.english, message.spanish, timeStr);
      appendStreamItem(message.english, message.spanish, timeStr);
    }
  });

  // 4. Capturar audio de OTRA ventana (Zoom, Teams, reproductor, otra ventana de Chrome)
  btnCaptureDesktop.addEventListener('click', async () => {
    if (!isDesktopCapturing) {
      await startCaptureOtherWindow();
    } else {
      stopCaptureOtherWindow();
    }
  });

  async function startCaptureOtherWindow() {
    try {
      const { groqApiKey } = await chrome.storage.local.get(['groqApiKey']);
      const apiKey = groqApiKey;

      if (!apiKey || apiKey.trim() === '') {
        alert('Configura tu clave gratuita de Groq (gsk_...) en la extensión antes de capturar.');
        return;
      }

      // Selector nativo de Windows / Chrome para elegir ventana o pantalla completa
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks || audioTracks.length === 0) {
        stream.getTracks().forEach(t => t.stop());
        alert('¡Importante! Debes marcar la casilla "Compartir audio del sistema" o "Compartir audio de la ventana" en el diálogo de selección.');
        return;
      }

      desktopMediaStream = stream;
      isDesktopCapturing = true;
      btnCaptureDesktop.classList.add('recording');
      desktopBtnText.textContent = 'Detener escucha';
      connectionStatus.textContent = 'Escuchando ventana compartida...';

      // Configurar AudioContext y Analyser para detectar sonido
      desktopAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = desktopAudioContext.createMediaStreamSource(stream);
      // Conectar a parlantes si el usuario quiere escucharlo (por si fuera captura silenciosa)
      source.connect(desktopAudioContext.destination);

      desktopAnalyser = desktopAudioContext.createAnalyser();
      desktopAnalyser.fftSize = 256;
      source.connect(desktopAnalyser);

      // Si el usuario presiona "Dejar de compartir" en la barra de Chrome
      stream.getVideoTracks()[0].onended = () => {
        stopCaptureOtherWindow();
      };

      // Iniciar bucle de grabación continua por fragmentos
      scheduleDesktopChunk(apiKey);

    } catch (err) {
      console.warn('Captura de ventana cancelada:', err);
    }
  }

  function stopCaptureOtherWindow() {
    isDesktopCapturing = false;

    if (desktopRecorder && desktopRecorder.state !== 'inactive') {
      try { desktopRecorder.stop(); } catch (e) {}
    }

    if (desktopMediaStream) {
      desktopMediaStream.getTracks().forEach(t => t.stop());
      desktopMediaStream = null;
    }

    if (desktopAudioContext && desktopAudioContext.state !== 'closed') {
      try { desktopAudioContext.close(); } catch (e) {}
      desktopAudioContext = null;
    }

    btnCaptureDesktop.classList.remove('recording');
    desktopBtnText.textContent = 'Escuchar otra ventana / Zoom';
    connectionStatus.textContent = 'En vivo (Segundo Monitor)';
  }

  function scheduleDesktopChunk(apiKey) {
    if (!isDesktopCapturing || !desktopMediaStream) return;

    let chunks = [];
    let maxVolume = 0;
    const dataArray = new Uint8Array(desktopAnalyser.frequencyBinCount);

    const volumeCheck = setInterval(() => {
      if (!desktopAnalyser) return;
      desktopAnalyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;
      if (avg > maxVolume) maxVolume = avg;
    }, 100);

    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';

    try {
      desktopRecorder = new MediaRecorder(desktopMediaStream, { mimeType });
    } catch (e) {
      console.error(e);
      return;
    }

    desktopRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    desktopRecorder.onstop = async () => {
      clearInterval(volumeCheck);

      if (isDesktopCapturing) {
        setTimeout(() => scheduleDesktopChunk(apiKey), 50);
      }

      if (chunks.length > 0 && maxVolume > 1.5) {
        const audioBlob = new Blob(chunks, { type: mimeType });
        processDesktopAudio(audioBlob, apiKey);
      }
    };

    desktopRecorder.start();

    setTimeout(() => {
      if (desktopRecorder && desktopRecorder.state === 'recording') {
        try { desktopRecorder.stop(); } catch (e) {}
      }
    }, 3500);
  }

  async function processDesktopAudio(blob, apiKey) {
    try {
      const formData = new FormData();
      formData.append('file', blob, 'audio.webm');
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('language', 'en');
      formData.append('response_format', 'json');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData
      });

      if (!res.ok) return;
      const data = await res.json();
      const en = (data.text || '').trim();
      if (!en) return;

      // Traducir gratis
      const es = await translateFree(en);
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      updateLiveCard(en, es, timeStr);
      appendStreamItem(en, es, timeStr);

      // Guardar en storage
      saveToSessionHistory(en, es, timeStr);
    } catch (err) {
      console.warn('Error procesando audio de ventana:', err);
    }
  }

  async function translateFree(text) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url);
      if (!res.ok) return text;
      const data = await res.json();
      if (data && data[0]) {
        return data[0].map(item => item[0]).join('');
      }
    } catch (e) {}
    return text;
  }

  function saveToSessionHistory(english, spanish, time) {
    chrome.storage.local.get(['sessionHistory'], (res) => {
      const history = res.sessionHistory || [];
      history.push({ english, spanish, time });
      if (history.length > 100) history.shift();
      chrome.storage.local.set({ sessionHistory: history });
    });
  }

  // 5. Actualizar tarjeta principal
  function updateLiveCard(en, es, timeStr) {
    if (es) {
      textEs.textContent = es;
      textEs.classList.remove('animate-in');
      void textEs.offsetWidth;
      textEs.classList.add('animate-in');
    }
    if (en) {
      textEn.textContent = en;
      textEn.classList.remove('animate-in');
      void textEn.offsetWidth;
      textEn.classList.add('animate-in');
    }
    if (timeStr) {
      liveClock.textContent = timeStr;
    }
  }

  // 6. Agregar al flujo continuo (Teleprompter)
  function appendStreamItem(en, es, timeStr) {
    const emptyEl = streamList.querySelector('.stream-empty');
    if (emptyEl) emptyEl.remove();

    const item = document.createElement('div');
    item.className = 'stream-item';
    item.innerHTML = `
      <span class="stream-time">${timeStr}</span>
      <span class="stream-en">${escapeHtml(en)}</span>
      <span class="stream-es">${escapeHtml(es)}</span>
    `;
    streamList.appendChild(item);

    if (chkAutoScroll.checked) {
      streamList.scrollTop = streamList.scrollHeight;
    }
  }

  function renderFullStream(history) {
    streamList.innerHTML = '';
    history.forEach(item => {
      appendStreamItem(item.english, item.spanish, item.time);
    });
  }

  // 7. Controles de visualización
  btnToggleMode.addEventListener('click', () => {
    isBilingual = !isBilingual;
    if (isBilingual) {
      document.body.classList.remove('spanish-only');
      modeText.textContent = 'Bilingüe (EN + ES)';
    } else {
      document.body.classList.add('spanish-only');
      modeText.textContent = 'Solo Español';
    }
  });

  btnFontInc.addEventListener('click', () => {
    if (currentMainSize < 48) {
      currentMainSize += 3;
      textEs.style.fontSize = `${currentMainSize}px`;
      textEn.style.fontSize = `${Math.max(14, currentMainSize - 8)}px`;
    }
  });

  btnFontDec.addEventListener('click', () => {
    if (currentMainSize > 18) {
      currentMainSize -= 3;
      textEs.style.fontSize = `${currentMainSize}px`;
      textEn.style.fontSize = `${Math.max(14, currentMainSize - 8)}px`;
    }
  });

  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  btnPip.addEventListener('click', async () => {
    if ('documentPictureInPicture' in window) {
      try {
        const pipWin = await window.documentPictureInPicture.requestWindow({
          width: 550,
          height: 350
        });
        [...document.styleSheets].forEach((styleSheet) => {
          try {
            const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
            const style = document.createElement('style');
            style.textContent = cssRules;
            pipWin.document.head.appendChild(style);
          } catch (e) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = styleSheet.href;
            pipWin.document.head.appendChild(link);
          }
        });
        pipWin.document.body.appendChild(document.querySelector('.viewer-container'));
      } catch (err) {
        console.warn('Error iniciando PIP:', err);
      }
    } else {
      alert('Esta ventana ya es independiente. Puedes arrastrarla directamente a tu segundo monitor.');
    }
  });

  // 8. Copiar y Exportar
  btnCopyStream.addEventListener('click', async () => {
    const { sessionHistory } = await chrome.storage.local.get(['sessionHistory']);
    if (!sessionHistory || sessionHistory.length === 0) {
      alert('No hay subtítulos para copiar.');
      return;
    }
    const txt = sessionHistory.map(i => `[${i.time}]\nEN: ${i.english}\nES: ${i.spanish}\n`).join('\n');
    navigator.clipboard.writeText(txt).then(() => {
      const orig = btnCopyStream.textContent;
      btnCopyStream.textContent = '✓ Copiado';
      setTimeout(() => { btnCopyStream.textContent = orig; }, 1500);
    });
  });

  btnExportStream.addEventListener('click', async () => {
    const { sessionHistory } = await chrome.storage.local.get(['sessionHistory']);
    if (!sessionHistory || sessionHistory.length === 0) {
      alert('No hay subtítulos para exportar.');
      return;
    }
    const txt = `--- TRANSCRIPCIÓN SEGUNDO MONITOR ---\n` +
      sessionHistory.map(i => `[${i.time}]\n[EN] ${i.english}\n[ES] ${i.spanish}\n`).join('\n');
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcripcion-monitor-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a);
  });

  btnClearStream.addEventListener('click', async () => {
    if (confirm('¿Vaciar el flujo de subtítulos?')) {
      await chrome.storage.local.set({ sessionHistory: [] });
      streamList.innerHTML = '<div class="stream-empty">Las frases traducidas se acumularán aquí cronológicamente...</div>';
      textEs.textContent = 'Esperando audio para traducir...';
      textEn.textContent = 'Waiting for English audio speech...';
    }
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
});

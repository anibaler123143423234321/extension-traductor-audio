/**
 * Configuración persistente (chrome.storage.local) compartida por todas las vistas.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  engine: 'auto', // auto | webspeech | deepgram | groq
  source: 'tab', // tab | display | mic
  sourceLang: 'en',
  targetLang: 'es',
  captionMode: 'bilingual', // bilingual | translation
  fontSize: 20,
  deepgramApiKey: '',
  groqApiKey: ''
});

export const ENGINE_INFO = {
  auto: {
    label: 'Automático (recomendado)',
    hint: 'Usa Deepgram si tienes clave; si no, Chrome Live. Si un motor falla, pasa al siguiente.'
  },
  webspeech: {
    label: 'Chrome Live · gratis',
    hint: 'Tiempo real (< 1 s). Sin clave. Usa el reconocimiento de voz de Google integrado en Chrome.'
  },
  deepgram: {
    label: 'Deepgram Nova · streaming',
    hint: 'Tiempo real (< 1 s) y máxima precisión. Requiere clave de Deepgram (incluye crédito gratis).'
  },
  groq: {
    label: 'Groq Whisper · por frases',
    hint: 'Traduce al terminar cada frase (1–3 s). Plan gratis limitado a ~12 frases por minuto.'
  }
};

export async function loadSettings() {
  const stored = await chrome.storage.local.get(null);
  return normalizeSettings(stored);
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

/** Admite claves de versiones anteriores (captionMode "spanish", chunkInterval…). */
export function normalizeSettings(stored = {}) {
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (stored[key] !== undefined && stored[key] !== null) settings[key] = stored[key];
  }
  if (settings.captionMode === 'spanish') settings.captionMode = 'translation';
  if (!ENGINE_INFO[settings.engine]) settings.engine = DEFAULT_SETTINGS.engine;
  settings.fontSize = clamp(Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize, 14, 48);
  return settings;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

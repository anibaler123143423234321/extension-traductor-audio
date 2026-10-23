import { AppError } from '../errors.js';
import { getLanguage } from '../languages.js';

const SpeechRecognitionImpl = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

// Chrome finaliza la frase por sí solo; si alguien habla sin pausas forzamos
// el corte para que el subtítulo no crezca indefinidamente.
const MAX_INTERIM_CHARS = 280;
const MAX_RAPID_RESTARTS = 8;

/**
 * Motor "Chrome Live": reconocimiento de voz en streaming de Chrome (gratis).
 * Recibe la pista de audio de la pestaña con SpeechRecognition.start(track),
 * disponible desde Chrome 133.
 */
export class WebSpeechEngine {
  static id = 'webspeech';
  static label = 'Chrome Live';

  constructor({ track, sourceLang, onTranscript, onError }) {
    this.track = track;
    this.lang = getLanguage(sourceLang).speech;
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.running = false;
    this.recognition = null;
    this.pendingInterim = '';
    this.rapidRestarts = 0;
    this.networkErrors = 0;
    this.sessionStartedAt = 0;
    this.restartTimer = null;
  }

  async start() {
    if (!SpeechRecognitionImpl) {
      throw new AppError('webspeech-unavailable', 'Este navegador no incluye el reconocimiento de voz de Chrome.');
    }
    if (!supportsTrackInput()) {
      throw new AppError(
        'webspeech-track-unsupported',
        'Tu versión de Chrome no permite que el motor gratuito escuche la pestaña. Actualiza Chrome o usa Deepgram/Groq.'
      );
    }
    this.running = true;
    try {
      await this.#startSession();
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    this.running = false;
    clearTimeout(this.restartTimer);
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      try { this.recognition.abort(); } catch { /* ya detenido */ }
      this.recognition = null;
    }
  }

  #startSession() {
    return new Promise((resolve, reject) => {
      const recognition = new SpeechRecognitionImpl();
      recognition.lang = this.lang;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      this.recognition = recognition;
      this.pendingInterim = '';

      let settled = false;
      const settle = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      recognition.onstart = () => {
        this.sessionStartedAt = Date.now();
        settle();
      };
      recognition.onresult = (event) => this.#handleResult(event);
      recognition.onerror = (event) => {
        const error = this.#mapError(event.error);
        if (!error) return;
        if (!settled) settle(error);
        else if (error.fatal) this.#fail(error);
      };
      recognition.onend = () => this.#handleEnd();

      try {
        recognition.start(this.track);
      } catch (error) {
        settle(new AppError('webspeech-start', `No se pudo iniciar Chrome Live: ${error.message}`, { cause: error }));
      }
      setTimeout(() => settle(), 4000);
    });
  }

  #handleResult(event) {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript?.trim() ?? '';
      if (!text) continue;
      if (result.isFinal) {
        this.onTranscript({ text, isFinal: true });
      } else {
        interim += `${text} `;
      }
    }
    this.pendingInterim = interim.trim();
    this.networkErrors = 0;
    if (this.pendingInterim) {
      this.onTranscript({ text: this.pendingInterim, isFinal: false });
      if (this.pendingInterim.length > MAX_INTERIM_CHARS) this.recognition?.stop();
    }
  }

  #handleEnd() {
    // Si la sesión terminó con texto sin confirmar, se confirma para no perderlo.
    if (this.pendingInterim) {
      this.onTranscript({ text: this.pendingInterim, isFinal: true });
      this.pendingInterim = '';
    }
    if (!this.running) return;

    if (this.track.readyState !== 'live') {
      this.#fail(new AppError('source-ended', 'La fuente de audio se cerró.'));
      return;
    }

    // Chrome cierra la sesión periódicamente: se reinicia al instante.
    const shortSession = Date.now() - this.sessionStartedAt < 1500;
    this.rapidRestarts = shortSession ? this.rapidRestarts + 1 : 0;
    if (this.rapidRestarts > MAX_RAPID_RESTARTS) {
      this.#fail(new AppError('webspeech-unstable', 'Chrome Live se detiene continuamente. Prueba otro motor.'));
      return;
    }
    const delay = shortSession ? Math.min(2000, 150 * this.rapidRestarts) : 0;
    this.restartTimer = setTimeout(() => {
      if (!this.running) return;
      this.#startSession().catch((error) => this.#fail(error));
    }, delay);
  }

  #mapError(code) {
    switch (code) {
      case 'no-speech':
      case 'aborted':
        return null;
      case 'network':
        this.networkErrors++;
        return this.networkErrors > 5
          ? new AppError('network', 'Chrome Live no puede conectar con el servicio de voz de Google. Revisa tu conexión.')
          : null;
      case 'not-allowed':
        return new AppError(
          'mic-permission',
          'Chrome necesita que concedas permiso de micrófono a la extensión una vez para usar el motor gratuito.'
        );
      case 'service-not-allowed':
        return new AppError('webspeech-blocked', 'El reconocimiento de voz de Chrome está bloqueado en este navegador.');
      case 'language-not-supported':
        return new AppError('language-not-supported', 'Chrome Live no admite el idioma de audio elegido.');
      case 'audio-capture':
        return new AppError('audio-capture', 'Chrome Live no pudo leer el audio.');
      default:
        return new AppError(`webspeech-${code}`, `Error de Chrome Live: ${code}`, { fatal: false });
    }
  }

  #fail(error) {
    if (!this.running) return;
    this.stop();
    this.onError(error);
  }
}

let trackInputSupport;

/**
 * Detecta si start() acepta una MediaStreamTrack: con soporte, pasar un objeto
 * que no es una pista lanza TypeError; sin soporte el argumento se ignora.
 */
export function supportsTrackInput() {
  if (trackInputSupport !== undefined) return trackInputSupport;
  if (!SpeechRecognitionImpl) return (trackInputSupport = false);
  const probe = new SpeechRecognitionImpl();
  try {
    probe.start({});
  } catch (error) {
    return (trackInputSupport = error instanceof TypeError);
  }
  try { probe.abort(); } catch { /* sin efecto */ }
  return (trackInputSupport = false);
}

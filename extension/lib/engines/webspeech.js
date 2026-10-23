import { AppError } from '../errors.js';
import { getLanguage } from '../languages.js';
import { createLogger } from '../log.js';

const log = createLogger('voz-navegador');

const SpeechRecognitionImpl = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

// Chrome finaliza la frase por sí solo; si alguien habla sin pausas forzamos
// el corte para que el subtítulo no crezca indefinidamente.
const MAX_INTERIM_CHARS = 280;
const MAX_RAPID_RESTARTS = 8;
const START_TIMEOUT_MS = 15000;
// En Chrome para Android el modo continuo duplica resultados: se usan sesiones
// cortas que se reinician al terminar cada frase.
const IS_ANDROID = /Android/i.test(globalThis.navigator?.userAgent ?? '');

/**
 * Motor "Chrome Live": reconocimiento de voz en streaming del navegador (gratis).
 * - Con `track`: escucha esa pista (audio de la pestaña) con
 *   SpeechRecognition.start(track), disponible desde Chrome 133.
 * - Sin `track`: escucha el micrófono directamente (web en el móvil).
 */
export class WebSpeechEngine {
  static id = 'webspeech';
  static label = 'Chrome Live';
  // Puede abrir el micrófono por sí mismo sin que se le pase una pista.
  static opensOwnMic = true;

  constructor({ track, sourceLang, onTranscript, onError, onWarning }) {
    this.track = track;
    this.lang = getLanguage(sourceLang).speech;
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.onWarning = onWarning;
    this.silentSessions = 0;
    this.running = false;
    this.recognition = null;
    this.pendingInterim = '';
    this.rapidRestarts = 0;
    this.networkErrors = 0;
    this.sessionStartedAt = 0;
    this.sessionHadResult = false;
    this.restartTimer = null;
  }

  async start() {
    if (!SpeechRecognitionImpl) {
      throw new AppError('webspeech-unavailable', 'Este navegador no incluye reconocimiento de voz gratuito.');
    }
    if (this.track && !supportsTrackInput()) {
      throw new AppError(
        'webspeech-track-unsupported',
        'Tu versión de Chrome no permite que el motor gratuito escuche la pestaña. Actualiza Chrome o usa Deepgram/Groq.'
      );
    }
    this.running = true;
    log.info('Iniciando reconocimiento de voz del navegador', {
      idioma: this.lang,
      fuente: this.track ? `pista: ${this.track.label || 'audio'}` : 'micrófono predeterminado del sistema',
      continuo: !IS_ANDROID
    });
    try {
      await this.#startSession();
    } catch (error) {
      log.error('No se pudo iniciar', { codigo: error.code, mensaje: error.message });
      this.stop();
      throw error;
    }
  }

  stop() {
    if (this.running) log.info('Reconocimiento detenido');
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
      recognition.continuous = !IS_ANDROID;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      this.recognition = recognition;
      this.pendingInterim = '';
      this.sessionHadResult = false;

      let settled = false;
      const settle = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      const sessionCreatedAt = Date.now();
      recognition.onstart = () => {
        this.sessionStartedAt = Date.now();
        log.info('start: el reconocimiento está escuchando', { ms: this.sessionStartedAt - sessionCreatedAt });
        settle();
      };
      // Eventos de diagnóstico: indican si llega audio, sonido y voz.
      recognition.onaudiostart = () => log.info('audiostart: llega audio del micrófono');
      recognition.onsoundstart = () => log.info('soundstart: se detecta sonido');
      recognition.onspeechstart = () => log.info('speechstart: se detecta voz');
      recognition.onspeechend = () => log.debug('speechend: terminó la voz');
      recognition.onaudioend = () => log.debug('audioend: se dejó de capturar audio');
      recognition.onnomatch = () => log.warn('nomatch: hubo voz pero no se reconoció ninguna palabra');
      recognition.onresult = (event) => this.#handleResult(event);
      recognition.onerror = (event) => {
        log.warn(`error: ${event.error}`, event.message ? { mensaje: event.message } : undefined);
        const error = this.#mapError(event.error);
        if (!error) return;
        if (!settled) settle(error);
        else if (error.fatal) this.#fail(error);
      };
      recognition.onend = () => this.#handleEnd();

      try {
        if (this.track) recognition.start(this.track);
        else recognition.start();
        log.debug('start() llamado; esperando el evento start…');
      } catch (error) {
        settle(new AppError('webspeech-start', `No se pudo iniciar Chrome Live: ${error.message}`, { cause: error }));
      }
      // Si el navegador no responde (ni empieza ni da error) se considera un fallo.
      // El margen permite aceptar el aviso de permiso de micrófono.
      setTimeout(() => settle(new AppError('webspeech-timeout', 'El reconocimiento de voz del navegador no respondió.')), START_TIMEOUT_MS);
    });
  }

  #handleResult(event) {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript?.trim() ?? '';
      if (!text) continue;
      if (result.isFinal) {
        log.info(`resultado final: "${text}"`, { confianza: Number(result[0].confidence?.toFixed(2)) });
        this.onTranscript({ text, isFinal: true });
      } else {
        interim += `${text} `;
      }
    }
    this.pendingInterim = interim.trim();
    this.networkErrors = 0;
    this.silentSessions = 0;
    this.sessionHadResult = true;
    if (this.pendingInterim) {
      log.debug(`parcial: "${this.pendingInterim}"`);
      this.onTranscript({ text: this.pendingInterim, isFinal: false });
      if (this.pendingInterim.length > MAX_INTERIM_CHARS) this.recognition?.stop();
    }
  }

  #handleEnd() {
    log.info('end: terminó la sesión de reconocimiento', {
      duracionMs: this.sessionStartedAt ? Date.now() - this.sessionStartedAt : 0,
      huboResultado: this.sessionHadResult
    });
    // Si la sesión terminó con texto sin confirmar, se confirma para no perderlo.
    if (this.pendingInterim) {
      this.onTranscript({ text: this.pendingInterim, isFinal: true });
      this.pendingInterim = '';
    }
    if (!this.running) return;

    if (this.track && this.track.readyState !== 'live') {
      this.#fail(new AppError('source-ended', 'La fuente de audio se cerró.'));
      return;
    }

    // El navegador cierra la sesión periódicamente: se reinicia al instante.
    // Solo cuentan como fallo las sesiones muy cortas que no reconocieron nada.
    const shortSession = !this.sessionHadResult && Date.now() - this.sessionStartedAt < 1500;
    this.rapidRestarts = shortSession ? this.rapidRestarts + 1 : 0;
    if (this.rapidRestarts > MAX_RAPID_RESTARTS) {
      this.#fail(new AppError('webspeech-unstable', 'Chrome Live se detiene continuamente. Prueba otro motor.'));
      return;
    }
    const delay = shortSession ? Math.min(2000, 150 * this.rapidRestarts) : 0;
    log.debug('Reiniciando la sesión', { esperaMs: delay, reiniciosRapidos: this.rapidRestarts });
    this.restartTimer = setTimeout(() => {
      if (!this.running) return;
      this.#startSession().catch((error) => this.#fail(error));
    }, delay);
  }

  #mapError(code) {
    switch (code) {
      case 'no-speech':
        // Sin voz durante ~2 sesiones seguidas: probablemente no llega audio.
        log.warn('Sesión sin voz detectada', { sesionesSeguidas: this.silentSessions + 1 });
        if (++this.silentSessions === 2) {
          this.onWarning?.('No se detecta voz. Comprueba que el micrófono correcto esté activo y sin silenciar, y que se hable en el idioma elegido.');
        }
        return null;
      case 'aborted':
        return null;
      case 'network':
        this.networkErrors++;
        return this.networkErrors > 5
          ? new AppError('network', 'Chrome Live no puede conectar con el servicio de voz de Google. Revisa tu conexión.')
          : null;
      case 'not-allowed':
        return new AppError('mic-permission', 'Falta el permiso de micrófono para el reconocimiento de voz.');
      case 'service-not-allowed':
        return new AppError('webspeech-blocked', 'El reconocimiento de voz está bloqueado en este navegador.');
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
  log.warn('Este navegador no permite pasar una pista de audio a SpeechRecognition.start()');
  return (trackInputSupport = false);
}

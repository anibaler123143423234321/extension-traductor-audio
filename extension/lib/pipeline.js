import { AppError, serializeError } from './errors.js';
import { ENGINES, resolveEngineOrder } from './engines/index.js';
import { translateText, normalizeText } from './translator.js';

// Frecuencia máxima con la que se traduce el texto parcial mientras se habla.
const INTERIM_TRANSLATE_INTERVAL_MS = 350;
const KEPT_SEGMENTS = 12;
const WARNING_COOLDOWN_MS = 30000;

/**
 * Orquesta motor de voz + traducción y emite subtítulos:
 *   onCaption({ id, original, translated, isFinal, complete, translationFailed, ts, engine })
 * Un mismo `id` se actualiza varias veces (parcial → final → traducido).
 * `complete` indica que la frase es definitiva y ya tiene su traducción.
 *
 * Audio: o bien se pasa `track` (extensión: pestaña, ventana…), o bien
 * `acquireTrack` / `releaseTrack` (web con micrófono). En el segundo caso, los
 * motores que abren el micrófono por sí mismos lo hacen sin pista, para no
 * tener el micrófono abierto dos veces (en móviles suele fallar).
 */
export class CaptionPipeline {
  constructor({
    track,
    acquireTrack,
    releaseTrack,
    audioContext,
    settings,
    onCaption,
    onStatus,
    engines = ENGINES,
    translate = translateText
  }) {
    this.track = track ?? null;
    this.acquireTrack = acquireTrack;
    this.releaseTrack = releaseTrack;
    this.audioContext = audioContext;
    this.settings = settings;
    this.onCaption = onCaption;
    this.onStatus = onStatus;
    this.engines = engines;
    this.translate = translate;
    this.running = false;
    this.engine = null;
    this.engineIndex = -1;
    this.order = [];
    this.segmentId = 0;
    this.segments = new Map();
    this.lastWarningAt = 0;
  }

  get engineId() {
    return this.engine?.constructor.id ?? null;
  }

  async start() {
    this.running = true;
    this.order = resolveEngineOrder(this.settings);
    try {
      await this.#startFrom(0);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    this.running = false;
    const engine = this.engine;
    this.engine = null;
    engine?.stop();
    if (this.acquireTrack && this.track) {
      this.releaseTrack?.(this.track);
      this.track = null;
    }
    for (const segment of this.segments.values()) clearTimeout(segment.timer);
    this.segments.clear();
  }

  async #startFrom(index) {
    let lastError;
    for (let i = index; i < this.order.length; i++) {
      const Engine = this.engines[this.order[i]];
      if (!Engine) continue;

      let engine = null;
      try {
        const track = await this.#trackFor(Engine);
        if (!this.running) return;

        engine = new Engine({
          track,
          audioContext: this.audioContext,
          sourceLang: this.settings.sourceLang,
          apiKey: this.#apiKeyFor(Engine.id),
          onTranscript: (transcript) => this.#handleTranscript(engine, transcript),
          onError: (error) => this.#handleEngineError(engine, error),
          onWarning: (message) => this.onStatus({ type: 'warning', message })
        });
        this.engine = engine;
        this.engineIndex = i;
        await engine.start();
      } catch (error) {
        this.engine = null;
        lastError = error;
        if (i < this.order.length - 1) {
          this.onStatus({ type: 'warning', code: error.code, message: `${Engine.label}: ${error.message} Probando otro motor…` });
        }
        continue;
      }

      if (!this.running) {
        engine.stop();
        return;
      }
      this.onStatus({ type: 'engine', engine: Engine.id, label: Engine.label });
      return;
    }
    throw lastError ?? new AppError('no-engine', 'No hay ningún motor de voz disponible.');
  }

  async #trackFor(Engine) {
    if (!this.acquireTrack) return this.track;
    if (Engine.opensOwnMic) {
      if (this.track) {
        this.releaseTrack?.(this.track);
        this.track = null;
      }
      return null;
    }
    this.track ??= await this.acquireTrack();
    return this.track;
  }

  #apiKeyFor(engineId) {
    if (engineId === 'deepgram') return this.settings.deepgramApiKey;
    if (engineId === 'groq') return this.settings.groqApiKey;
    return '';
  }

  #handleEngineError(engine, error) {
    if (engine !== this.engine || !this.running) return;
    this.engine = null;
    const label = engine.constructor.label;

    if (this.engineIndex + 1 < this.order.length) {
      this.onStatus({ type: 'warning', code: error.code, message: `${label}: ${error.message} Cambiando de motor…` });
      this.#startFrom(this.engineIndex + 1).catch((nextError) => this.#fatal(nextError));
    } else {
      this.#fatal(error);
    }
  }

  #fatal(error) {
    if (!this.running) return;
    this.stop();
    this.onStatus({ type: 'error', error: serializeError(error) });
  }

  #handleTranscript(engine, { text, isFinal }) {
    if (engine !== this.engine || !this.running) return;
    const clean = normalizeText(text);
    if (!clean) return;

    const id = this.segmentId;
    if (isFinal) this.segmentId++;

    let segment = this.segments.get(id);
    if (!segment) {
      segment = { id, text: '', translated: '', final: false, failed: false, version: 0, applied: 0, lastRequestAt: 0, timer: null };
      this.segments.set(id, segment);
      this.#pruneSegments();
    }
    segment.text = clean;
    segment.final = isFinal;
    segment.version++;

    // El texto original se muestra al instante; la traducción llega después.
    this.#emit(segment, false);
    this.#scheduleTranslation(segment);
  }

  #scheduleTranslation(segment) {
    const { sourceLang, targetLang } = this.settings;
    if (sourceLang === targetLang) {
      segment.translated = segment.text;
      segment.applied = segment.version;
      this.#emit(segment, segment.final);
      return;
    }

    clearTimeout(segment.timer);
    const wait = segment.final ? 0 : Math.max(0, segment.lastRequestAt + INTERIM_TRANSLATE_INTERVAL_MS - Date.now());
    if (wait === 0) this.#translate(segment);
    else segment.timer = setTimeout(() => this.#translate(segment), wait);
  }

  async #translate(segment) {
    segment.timer = null;
    segment.lastRequestAt = Date.now();
    const { version, text, final } = segment;

    try {
      const translated = await this.translate(text, this.settings.sourceLang, this.settings.targetLang);
      // Se descartan respuestas antiguas que lleguen después de otras más nuevas.
      if (!this.running || version <= segment.applied) return;
      segment.applied = version;
      segment.translated = translated;
      this.#emit(segment, final && version === segment.version);
    } catch (error) {
      if (!this.running) return;
      if (final && version === segment.version) {
        segment.failed = true;
        this.#emit(segment, true);
      }
      const now = Date.now();
      if (now - this.lastWarningAt > WARNING_COOLDOWN_MS) {
        this.lastWarningAt = now;
        this.onStatus({ type: 'warning', message: `No se pudo traducir: ${error.message}` });
      }
    }
  }

  #emit(segment, complete) {
    this.onCaption({
      id: segment.id,
      original: segment.text,
      translated: segment.translated,
      isFinal: segment.final,
      complete,
      translationFailed: segment.failed,
      ts: Date.now(),
      engine: this.engineId
    });
  }

  #pruneSegments() {
    while (this.segments.size > KEPT_SEGMENTS) {
      const oldest = this.segments.keys().next().value;
      clearTimeout(this.segments.get(oldest).timer);
      this.segments.delete(oldest);
    }
  }
}

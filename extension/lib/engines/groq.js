import { AppError } from '../errors.js';
import { PcmCapture, PCM_SAMPLE_RATE, PCM_FRAME_SIZE } from '../audio/pcm-capture.js';
import { VadSegmenter } from '../audio/vad.js';
import { encodeWav } from '../audio/wav.js';
import { createLogger } from '../log.js';

const log = createLogger('groq');

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';
// Plan gratuito: 7.200 s de audio por hora y Groq factura mínimo 10 s por
// petición → 720 peticiones/hora = 12 por minuto sostenidas.
const MAX_REQUESTS_PER_MINUTE = 12;
const MAX_IN_FLIGHT = 2;
const REQUEST_TIMEOUT_MS = 15000;

// Frases que Whisper suele inventar cuando el audio es casi silencio.
const HALLUCINATIONS = [
  /^(thank you|thanks)( (so much|very much|for watching|for listening))?[.!]*$/i,
  /^(you|bye|okay|so)[.!]*$/i,
  /subtitles? (by|from)|amara\.org|transcribed by|please subscribe/i,
  /^(gracias( por ver)?|suscríbete)[.!]*$/i
];

/**
 * Motor Groq Whisper: corta el audio en frases con un detector de voz y
 * transcribe cada frase. Mantiene el orden y respeta los límites del plan gratis.
 */
export class GroqEngine {
  static id = 'groq';
  static label = 'Groq Whisper';

  constructor({ track, audioContext, sourceLang, apiKey, onTranscript, onError, onWarning, fetchImpl }) {
    this.track = track;
    this.audioContext = audioContext;
    this.language = sourceLang;
    this.apiKey = (apiKey || '').trim();
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.onWarning = onWarning;
    this.fetchImpl = fetchImpl ?? ((...args) => fetch(...args));
    this.running = false;
    this.capture = null;
    this.queue = [];
    this.inFlight = 0;
    this.nextSeq = 0;
    this.nextToDeliver = 0;
    this.results = new Map();
    this.requestTimes = [];
    this.pausedUntil = 0;
    this.pumpTimer = null;
    this.context = '';
    this.abort = new AbortController();
    this.segmenter = new VadSegmenter({
      sampleRate: PCM_SAMPLE_RATE,
      frameSize: PCM_FRAME_SIZE,
      onSegment: (segment) => this.enqueue(segment.samples)
    });
  }

  async start() {
    if (!this.apiKey) {
      throw new AppError('groq-missing-key', 'Falta la clave de Groq. Agrégala en "Claves de API".');
    }
    this.running = true;
    try {
      this.capture = await PcmCapture.create(this.track, {
        audioContext: this.audioContext,
        onFrame: (frame) => this.segmenter.push(frame)
      });
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    this.running = false;
    this.segmenter.reset();
    this.capture?.close();
    this.capture = null;
    clearTimeout(this.pumpTimer);
    this.queue = [];
    this.abort.abort();
  }

  enqueue(samples) {
    if (!this.running) return;
    log.debug('Frase detectada', { segundos: Number((samples.length / PCM_SAMPLE_RATE).toFixed(2)), enCola: this.queue.length + 1 });
    this.queue.push(samples);
    this.#pump();
  }

  #pump() {
    clearTimeout(this.pumpTimer);
    while (this.running && this.queue.length && this.inFlight < MAX_IN_FLIGHT) {
      const waitMs = this.#rateLimitWait();
      if (waitMs > 0) {
        log.debug('Esperando por el límite de peticiones', { esperaMs: waitMs });
        this.pumpTimer = setTimeout(() => this.#pump(), waitMs);
        return;
      }
      // Si se acumularon frases por el límite, se envían juntas en una sola petición.
      const samples = concatSegments(this.queue.splice(0));
      this.requestTimes.push(Date.now());
      this.#transcribe(this.nextSeq++, samples);
    }
  }

  #rateLimitWait() {
    const now = Date.now();
    if (this.pausedUntil > now) return this.pausedUntil - now;
    this.requestTimes = this.requestTimes.filter((t) => now - t < 60000);
    if (this.requestTimes.length < MAX_REQUESTS_PER_MINUTE) return 0;
    return this.requestTimes[0] + 60000 - now;
  }

  async #transcribe(seq, samples) {
    this.inFlight++;
    let text = '';
    const startedAt = Date.now();
    try {
      text = await this.#request(samples);
      log.info(`Respuesta #${seq}: "${text}"`, { ms: Date.now() - startedAt, segundosAudio: Number((samples.length / PCM_SAMPLE_RATE).toFixed(2)) });
    } catch (error) {
      log.warn(`Petición #${seq} falló`, { codigo: error.code ?? error.name, mensaje: error.message, ms: Date.now() - startedAt });
      if (error.fatal) {
        this.#fail(error);
        return;
      }
      if (error.name !== 'AbortError') this.onWarning?.(error.message);
    } finally {
      this.inFlight--;
    }
    this.results.set(seq, text);
    this.#deliverInOrder();
    this.#pump();
  }

  async #request(samples) {
    const form = new FormData();
    form.append('file', new Blob([encodeWav(samples, PCM_SAMPLE_RATE)], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', MODEL);
    form.append('language', this.language);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (this.context) form.append('prompt', this.context);

    const response = await this.fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    });

    if (response.status === 401 || response.status === 403) {
      throw new AppError('groq-auth', 'La clave de Groq no es válida. Revísala en "Claves de API".');
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after')) || 20;
      this.pausedUntil = Date.now() + retryAfter * 1000;
      throw new AppError('groq-rate-limit', `Límite gratuito de Groq alcanzado; se reanuda en ${retryAfter} s.`, { fatal: false });
    }
    if (!response.ok) {
      throw new AppError('groq-http', `Groq respondió ${response.status}.`, { fatal: false });
    }
    return cleanTranscript(await response.json());
  }

  #deliverInOrder() {
    while (this.results.has(this.nextToDeliver)) {
      const text = this.results.get(this.nextToDeliver);
      this.results.delete(this.nextToDeliver);
      this.nextToDeliver++;
      if (text && this.running) {
        this.context = text.slice(-200);
        this.onTranscript({ text, isFinal: true });
      }
    }
  }

  #fail(error) {
    if (!this.running) return;
    this.stop();
    this.onError(error);
  }
}

/** Descarta segmentos que Whisper marca como silencio y frases inventadas típicas. */
export function cleanTranscript(data) {
  const segments = Array.isArray(data?.segments) ? data.segments : null;
  const text = segments
    ? segments
      .filter((s) => !(s.no_speech_prob > 0.6 && s.avg_logprob < -0.5))
      .map((s) => s.text)
      .join(' ')
    : data?.text ?? '';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean || HALLUCINATIONS.some((re) => re.test(clean))) return '';
  return clean;
}

function concatSegments(segments) {
  if (segments.length === 1) return segments[0];
  const gap = Math.round(PCM_SAMPLE_RATE * 0.2);
  const total = segments.reduce((sum, s) => sum + s.length, 0) + gap * (segments.length - 1);
  const output = new Float32Array(total);
  let offset = 0;
  for (const segment of segments) {
    output.set(segment, offset);
    offset += segment.length + gap;
  }
  return output;
}

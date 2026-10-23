import { AppError } from '../errors.js';
import { getLanguage } from '../languages.js';
import { PcmCapture, PCM_SAMPLE_RATE, floatTo16BitPcm } from '../audio/pcm-capture.js';
import { createLogger } from '../log.js';

const log = createLogger('deepgram');

const FRAMES_PER_PACKET = 5; // 5 × 20 ms = 100 ms por envío
const MAX_UTTERANCE_CHARS = 240;
const MAX_RECONNECTS = 3;

/**
 * Motor Deepgram: streaming por WebSocket con resultados parciales (< 1 s).
 */
export class DeepgramEngine {
  static id = 'deepgram';
  static label = 'Deepgram';

  constructor({ track, audioContext, sourceLang, apiKey, onTranscript, onError, onWarning }) {
    this.track = track;
    this.audioContext = audioContext;
    this.language = getLanguage(sourceLang);
    this.apiKey = (apiKey || '').trim();
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.onWarning = onWarning;
    this.running = false;
    this.socket = null;
    this.capture = null;
    this.packet = [];
    this.finalized = [];
    this.reconnects = 0;
  }

  async start() {
    if (!this.apiKey) {
      throw new AppError('deepgram-missing-key', 'Falta la clave de Deepgram. Agrégala en "Claves de API".');
    }
    this.running = true;
    try {
      await this.#connect();
      this.capture = await PcmCapture.create(this.track, {
        audioContext: this.audioContext,
        onFrame: (frame) => this.#handleFrame(frame)
      });
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    this.running = false;
    this.capture?.close();
    this.capture = null;
    this.#flushUtterance();
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.onclose = null;
      socket.onmessage = null;
      if (socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ type: 'CloseStream' })); } catch { /* cerrado */ }
      }
      try { socket.close(); } catch { /* cerrado */ }
    }
  }

  #connect() {
    const params = new URLSearchParams({
      model: this.language.deepgramModel,
      language: this.language.code,
      encoding: 'linear16',
      sample_rate: String(PCM_SAMPLE_RATE),
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      endpointing: '300',
      utterance_end_ms: '1000'
    });

    log.info('Conectando', { modelo: this.language.deepgramModel, idioma: this.language.code });
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['token', this.apiKey]);
      socket.binaryType = 'arraybuffer';
      let opened = false;

      socket.onopen = () => {
        log.info('Conectado');
        opened = true;
        this.socket = socket;
        this.reconnects = 0;
        resolve();
      };
      socket.onmessage = (event) => this.#handleMessage(event.data);
      socket.onclose = (event) => {
        log.warn('Conexión cerrada', { codigo: event.code, motivo: event.reason || undefined, abierta: opened });
        if (!opened) {
          reject(new AppError(
            'deepgram-connect',
            'No se pudo conectar con Deepgram. Revisa que la clave sea correcta y tenga saldo.'
          ));
          return;
        }
        if (this.socket === socket) this.#handleUnexpectedClose(event);
      };
    });
  }

  async #handleUnexpectedClose(event) {
    this.socket = null;
    if (!this.running) return;
    this.#flushUtterance();
    if (this.reconnects >= MAX_RECONNECTS) {
      this.#fail(new AppError('deepgram-closed', `Deepgram cerró la conexión (${event.code} ${event.reason || ''}).`.trim()));
      return;
    }
    this.reconnects++;
    log.warn('Reconectando', { intento: this.reconnects });
    this.onWarning?.('Reconectando con Deepgram…');
    await new Promise((r) => setTimeout(r, 500 * this.reconnects));
    if (!this.running) return;
    try {
      await this.#connect();
    } catch (error) {
      this.#fail(error);
    }
  }

  #handleFrame(frame) {
    this.packet.push(frame);
    if (this.packet.length < FRAMES_PER_PACKET) return;

    const samples = new Float32Array(frame.length * this.packet.length);
    this.packet.forEach((f, i) => samples.set(f, i * frame.length));
    this.packet = [];
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(floatTo16BitPcm(samples).buffer);
  }

  #handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === 'Metadata') log.debug('Metadatos', { request_id: message.request_id });
    if (message.type === 'UtteranceEnd') {
      this.#flushUtterance();
      return;
    }
    if (message.type !== 'Results') return;

    const text = message.channel?.alternatives?.[0]?.transcript?.trim() ?? '';
    if (message.is_final) {
      if (text) this.finalized.push(text);
      const utterance = this.finalized.join(' ');
      if (message.speech_final || utterance.length > MAX_UTTERANCE_CHARS) {
        this.#flushUtterance();
      } else if (utterance) {
        this.onTranscript({ text: utterance, isFinal: false });
      }
    } else if (text || this.finalized.length) {
      this.onTranscript({ text: [...this.finalized, text].join(' ').trim(), isFinal: false });
    }
  }

  #flushUtterance() {
    const utterance = this.finalized.join(' ').trim();
    this.finalized = [];
    if (utterance) this.onTranscript({ text: utterance, isFinal: true });
  }

  #fail(error) {
    if (!this.running) return;
    this.stop();
    this.onError(error);
  }
}

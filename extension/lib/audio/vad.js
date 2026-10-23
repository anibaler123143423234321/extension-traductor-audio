/**
 * Detector de voz por energía con umbral adaptativo.
 * Corta el audio en frases aprovechando las pausas, de modo que el motor
 * Whisper recibe frases completas en lugar de trozos fijos de 3,5 s.
 */
export class VadSegmenter {
  constructor({
    onSegment,
    sampleRate = 16000,
    frameSize = 320,
    minSilenceMs = 400,
    maxSegmentMs = 5000,
    preRollMs = 300,
    minSpeechMs = 250,
    minThreshold = 0.006,
    noiseRatio = 2.5,
    noiseWindowMs = 1500
  }) {
    this.onSegment = onSegment;
    this.frameMs = (frameSize / sampleRate) * 1000;
    this.minSilenceFrames = Math.round(minSilenceMs / this.frameMs);
    this.maxFrames = Math.round(maxSegmentMs / this.frameMs);
    this.preRollFrames = Math.round(preRollMs / this.frameMs);
    this.minSpeechFrames = Math.round(minSpeechMs / this.frameMs);
    this.cutSearchFrames = Math.round(800 / this.frameMs);
    this.minThreshold = minThreshold;
    this.noiseRatio = noiseRatio;
    // Ruido de fondo = energía mínima reciente: entre palabras siempre hay
    // pequeñas pausas, así que la voz continua no eleva el umbral, pero una
    // música constante sí (y deja de contar como voz).
    this.noiseHistory = new Float32Array(Math.round(noiseWindowMs / this.frameMs)).fill(Infinity);
    this.noiseIndex = 0;
    this.reset();
  }

  reset() {
    this.inSpeech = false;
    this.preRoll = [];
    this.frames = [];
    this.speechRun = 0;
    this.silenceRun = 0;
    this.speechFrames = 0;
  }

  push(samples) {
    const rms = computeRms(samples);
    this.noiseHistory[this.noiseIndex] = rms;
    this.noiseIndex = (this.noiseIndex + 1) % this.noiseHistory.length;
    let noiseFloor = Infinity;
    for (const value of this.noiseHistory) if (value < noiseFloor) noiseFloor = value;
    const isSpeech = rms > Math.max(this.minThreshold, noiseFloor * this.noiseRatio);

    const frame = { samples, rms, isSpeech };

    if (!this.inSpeech) {
      this.preRoll.push(frame);
      if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
      this.speechRun = isSpeech ? this.speechRun + 1 : 0;
      if (this.speechRun >= 2) {
        this.inSpeech = true;
        this.frames = this.preRoll;
        this.preRoll = [];
        this.speechFrames = this.speechRun;
        this.silenceRun = 0;
      }
      return;
    }

    this.frames.push(frame);
    if (isSpeech) {
      this.speechFrames++;
      this.silenceRun = 0;
    } else {
      this.silenceRun++;
    }

    if (this.silenceRun >= this.minSilenceFrames) {
      // Conserva ~150 ms del silencio final para no recortar la última palabra.
      const keep = this.frames.length - this.silenceRun + Math.round(150 / this.frameMs);
      this.#emit(this.frames.slice(0, keep));
      this.reset();
    } else if (this.frames.length >= this.maxFrames) {
      this.#forceCut();
    }
  }

  /** Emite lo que quede pendiente (al detener la captura). */
  flush() {
    if (this.inSpeech) this.#emit(this.frames);
    this.reset();
  }

  #forceCut() {
    // Corta en el punto más silencioso de los últimos 800 ms para no partir palabras.
    const start = Math.max(1, this.frames.length - this.cutSearchFrames);
    let cut = this.frames.length;
    let quietest = Infinity;
    for (let i = start; i < this.frames.length; i++) {
      if (this.frames[i].rms < quietest) {
        quietest = this.frames[i].rms;
        cut = i;
      }
    }
    const rest = this.frames.slice(cut);
    this.#emit(this.frames.slice(0, cut));
    this.frames = rest;
    this.speechFrames = rest.filter((f) => f.isSpeech).length;
    this.silenceRun = 0;
  }

  #emit(frames) {
    const speechFrames = frames.filter((f) => f.isSpeech).length;
    if (speechFrames < this.minSpeechFrames) return;

    const total = frames.reduce((sum, f) => sum + f.samples.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const f of frames) {
      samples.set(f.samples, offset);
      offset += f.samples.length;
    }
    this.onSegment({
      samples,
      durationMs: frames.length * this.frameMs,
      speechMs: speechFrames * this.frameMs
    });
  }
}

export function computeRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (samples.length || 1));
}

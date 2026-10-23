import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VadSegmenter, computeRms } from '../extension/lib/audio/vad.js';
import { encodeWav } from '../extension/lib/audio/wav.js';

const RATE = 16000;
const FRAME = 320;

let clock = 0;
function feed(segmenter, generator, ms) {
  const frames = Math.round(ms / 20);
  for (let f = 0; f < frames; f++) {
    const frame = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) frame[i] = generator(clock++ / RATE);
    segmenter.push(frame);
  }
}

const noise = (level) => (Math.random() - 0.5) * level;
const silence = () => noise(0.002);
// Voz sintética: tono modulado a ~3 sílabas por segundo, con caídas entre sílabas.
const speech = (t) => 0.3 * Math.abs(Math.sin(2 * Math.PI * 3 * t)) * Math.sin(2 * Math.PI * 220 * t) + noise(0.002);
const music = (t) => 0.15 * Math.sin(2 * Math.PI * 330 * t);

test('VAD corta una frase al detectar la pausa', () => {
  const segments = [];
  const vad = new VadSegmenter({ onSegment: (s) => segments.push(s) });
  feed(vad, silence, 600);
  feed(vad, speech, 1200);
  feed(vad, silence, 700);

  assert.equal(segments.length, 1);
  const [segment] = segments;
  assert.ok(segment.speechMs >= 800 && segment.speechMs <= 1300, `voz: ${segment.speechMs} ms`);
  // Frase + pre-roll (≤300 ms) + cola de silencio (150 ms)
  assert.ok(segment.durationMs >= 1100 && segment.durationMs <= 1700, `duración: ${segment.durationMs} ms`);
  assert.equal(segment.samples.length, (segment.durationMs / 20) * FRAME);
});

test('VAD fuerza cortes en discursos largos sin pausas', () => {
  const segments = [];
  const vad = new VadSegmenter({ onSegment: (s) => segments.push(s), maxSegmentMs: 5000 });
  feed(vad, silence, 400);
  feed(vad, speech, 12000);
  vad.flush();

  assert.ok(segments.length >= 3, `segmentos: ${segments.length}`);
  for (const s of segments) assert.ok(s.durationMs <= 5000, `segmento de ${s.durationMs} ms`);
  const total = segments.reduce((sum, s) => sum + s.durationMs, 0);
  assert.ok(total >= 11500, `no se debe perder audio (total ${total} ms)`);
});

test('VAD deja de considerar voz una música constante', () => {
  const segments = [];
  const vad = new VadSegmenter({ onSegment: (s) => segments.push(s) });
  feed(vad, music, 10000);
  vad.flush();
  const total = segments.reduce((sum, s) => sum + s.durationMs, 0);
  assert.ok(total <= 2500, `música tratada como voz durante ${total} ms`);
});

test('VAD ignora ruidos muy cortos y el silencio', () => {
  const segments = [];
  const vad = new VadSegmenter({ onSegment: (s) => segments.push(s) });
  feed(vad, silence, 1000);
  feed(vad, speech, 100); // clic de 100 ms
  feed(vad, silence, 1000);
  vad.flush();
  assert.equal(segments.length, 0);
});

test('computeRms calcula la energía', () => {
  assert.equal(computeRms(new Float32Array(10)), 0);
  assert.ok(Math.abs(computeRms(new Float32Array(10).fill(0.5)) - 0.5) < 1e-9);
});

test('encodeWav genera una cabecera WAV PCM válida', () => {
  const samples = new Float32Array([0, 1, -1, 0.5, 2]);
  const buffer = encodeWav(samples, RATE);
  const view = new DataView(buffer);
  const ascii = (offset) => String.fromCharCode(...new Uint8Array(buffer, offset, 4));

  assert.equal(buffer.byteLength, 44 + samples.length * 2);
  assert.equal(ascii(0), 'RIFF');
  assert.equal(ascii(8), 'WAVE');
  assert.equal(ascii(36), 'data');
  assert.equal(view.getUint32(24, true), RATE);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getInt16(44 + 2, true), 32767);
  assert.equal(view.getInt16(44 + 4, true), -32768);
  assert.equal(view.getInt16(44 + 8, true), 32767, 'los valores fuera de rango se recortan');
});

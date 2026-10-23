import { floatTo16BitPcm } from './pcm-capture.js';

/** Codifica muestras Float32 mono como WAV PCM de 16 bits. */
export function encodeWav(samples, sampleRate) {
  const pcm = floatTo16BitPcm(samples);
  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // tamaño del bloque fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes por segundo
  view.setUint16(32, 2, true); // bytes por muestra
  view.setUint16(34, 16, true); // bits por muestra
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  new Int16Array(buffer, 44).set(pcm);

  return buffer;
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

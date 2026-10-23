/**
 * Obtiene PCM mono a 16 kHz de una pista de audio usando un AudioWorklet.
 */
export const PCM_SAMPLE_RATE = 16000;
export const PCM_FRAME_SIZE = 320; // 20 ms

export class PcmCapture {
  static async create(track, { audioContext, onFrame }) {
    const context = audioContext ?? new AudioContext({ latencyHint: 'interactive' });
    await context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
    if (context.state === 'suspended') await context.resume().catch(() => {});

    const source = context.createMediaStreamSource(new MediaStream([track]));
    const node = new AudioWorkletNode(context, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { targetRate: PCM_SAMPLE_RATE, frameSize: PCM_FRAME_SIZE }
    });
    node.port.onmessage = (event) => onFrame(event.data);

    // El nodo solo genera silencio; se conecta al destino para que Chrome lo procese.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(context.destination);

    return new PcmCapture({ context, ownsContext: !audioContext, source, node, mute });
  }

  constructor({ context, ownsContext, source, node, mute }) {
    this.context = context;
    this.ownsContext = ownsContext;
    this.source = source;
    this.node = node;
    this.mute = mute;
  }

  close() {
    this.node.port.onmessage = null;
    for (const audioNode of [this.source, this.node, this.mute]) {
      try { audioNode.disconnect(); } catch { /* ya desconectado */ }
    }
    if (this.ownsContext && this.context.state !== 'closed') this.context.close().catch(() => {});
  }
}

export function floatTo16BitPcm(samples) {
  const output = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

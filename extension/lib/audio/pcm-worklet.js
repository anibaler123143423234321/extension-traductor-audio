/**
 * AudioWorklet: mezcla a mono, reduce la frecuencia a 16 kHz y envía
 * bloques de 20 ms (320 muestras Float32) al hilo principal.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { targetRate = 16000, frameSize = 320 } = options.processorOptions ?? {};
    this.ratio = sampleRate / targetRate;
    this.frameSize = frameSize;
    this.frame = new Float32Array(frameSize);
    this.frameIndex = 0;
    this.position = 0;
    this.accumulator = 0;
    this.accumulatorCount = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channels = input.length;
    const length = input[0].length;
    for (let i = 0; i < length; i++) {
      let sample = 0;
      for (let c = 0; c < channels; c++) sample += input[c][i];
      this.accumulator += sample / channels;
      this.accumulatorCount++;
      this.position += 1;

      // Decimación promediando: actúa también como filtro paso bajo sencillo.
      if (this.position >= this.ratio) {
        this.position -= this.ratio;
        this.frame[this.frameIndex++] = this.accumulator / this.accumulatorCount;
        this.accumulator = 0;
        this.accumulatorCount = 0;

        if (this.frameIndex === this.frameSize) {
          this.port.postMessage(this.frame, [this.frame.buffer]);
          this.frame = new Float32Array(this.frameSize);
          this.frameIndex = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);

import { CaptionPipeline } from './pipeline.js';
import { AppError, serializeError } from './errors.js';

/**
 * Une un MediaStream de audio con el pipeline de subtítulos.
 * Lo usan el documento offscreen (pestaña / micrófono) y la ventana de
 * segundo monitor (captura de otra ventana o pantalla).
 */
export class CaptureSession {
  constructor({ stream, playback = false, settings, onCaption, onStatus }) {
    this.stream = stream;
    this.playback = playback;
    this.settings = settings;
    this.onCaption = onCaption;
    this.onStatus = onStatus;
    this.audioContext = null;
    this.pipeline = null;
    this.stopped = false;
  }

  get engineId() {
    return this.pipeline?.engineId ?? null;
  }

  async start() {
    const track = this.stream.getAudioTracks()[0];
    if (!track) throw new AppError('no-audio', 'La fuente elegida no tiene audio.');

    this.audioContext = new AudioContext({ latencyHint: 'interactive' });
    if (this.audioContext.state === 'suspended') await this.audioContext.resume().catch(() => {});

    // tabCapture silencia la pestaña: se reproduce de nuevo para que la sigas escuchando.
    if (this.playback) this.audioContext.createMediaStreamSource(this.stream).connect(this.audioContext.destination);

    track.addEventListener('ended', () => {
      if (this.stopped) return;
      this.stop();
      this.onStatus({ type: 'error', error: serializeError(new AppError('source-ended', 'La fuente de audio se cerró.')) });
    });

    this.pipeline = new CaptionPipeline({
      track,
      audioContext: this.audioContext,
      settings: this.settings,
      onCaption: this.onCaption,
      onStatus: (status) => {
        if (status.type === 'error') this.stop();
        this.onStatus(status);
      }
    });

    try {
      await this.pipeline.start();
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.pipeline?.stop();
    for (const track of this.stream.getTracks()) track.stop();
    if (this.audioContext && this.audioContext.state !== 'closed') this.audioContext.close().catch(() => {});
  }
}

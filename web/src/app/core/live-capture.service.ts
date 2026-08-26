import { Injectable } from '@angular/core';

export interface LiveSession {
  pause(): void;
  resume(): void;
  paused(): boolean;
  stop(): Promise<{ blob: Blob; durationSeconds: number; transcript: string }>;
}

export interface LiveStartOptions {
  internalAudio?: boolean;
}

export function microphoneErrorMessage(error: unknown, voice = false): string {
  const blocked = microphoneBlockedReason();
  if (blocked) return blocked;
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: string }).name) : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return voice
      ? 'El micrófono está bloqueado para este sitio. En la barra de direcciones pulsa el icono de candado o de micrófono y permite el audio.'
      : 'El micrófono está bloqueado para este sitio. Permite el audio en el candado de la barra de direcciones.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No hay un micrófono conectado.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'El micrófono está ocupado por otra aplicación. Ciérrala y vuelve a intentar.';
  }
  if (name === 'SecurityError' || /secure|https|localhost/i.test(message)) {
    return microphoneBlockedReason() || message;
  }
  if (message) return message;
  return voice
    ? 'No se pudo acceder al micrófono. Permite el audio para grabar la nota de voz.'
    : 'No se pudo acceder al micrófono. Permite el audio para capturar la llamada.';
}

function microphoneBlockedReason(): string | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'El micrófono no está disponible.';
  }
  if (!window.isSecureContext) {
    return `El navegador no pide el micrófono en HTTP con una IP (${window.location.host}). Tiene que ser HTTPS o http://localhost. Reinicia con ./start.sh y entra a https://${window.location.host}.`;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'Este navegador no puede usar el micrófono.';
  }
  return null;
}

@Injectable({ providedIn: 'root' })
export class LiveCaptureService {
  async start(_onPartial: (text: string) => void = () => undefined, options: LiveStartOptions = {}): Promise<LiveSession> {
    const mic = await openMicrophone(!options.internalAudio);
    const speaker = options.internalAudio ? await openSpeakerAudio() : null;

    let audioContext: AudioContext | null = null;
    let recordStream = mic;
    const extraStops: Array<() => void> = [];

    if (options.internalAudio) {
      audioContext = new AudioContext();
      if (audioContext.state === 'suspended') void audioContext.resume();
      const mix = audioContext.createGain();
      const micSource = audioContext.createMediaStreamSource(mic);
      const micGain = audioContext.createGain();
      micGain.gain.value = 1.15;
      micSource.connect(micGain);
      micGain.connect(mix);
      if (speaker?.getAudioTracks().length) {
        const speakerSource = audioContext.createMediaStreamSource(speaker);
        const speakerGain = audioContext.createGain();
        speakerGain.gain.value = 1.7;
        speakerSource.connect(speakerGain);
        speakerGain.connect(mix);
        extraStops.push(() => speakerSource.disconnect());
      }
      const dest = audioContext.createMediaStreamDestination();
      mix.connect(dest);
      recordStream = dest.stream;
      extraStops.push(() => {
        micSource.disconnect();
        mix.disconnect();
        dest.stream.getTracks().forEach((track) => track.stop());
      });
    }

    const recorder = this.makeRecorder(recordStream);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.start(250);
    const startedAt = Date.now();
    let pausedAt = 0;
    let pausedMs = 0;

    return {
      pause() {
        try {
          if (recorder.state === 'recording') {
            recorder.pause();
            pausedAt = Date.now();
          }
        } catch {
          /* pause is optional on some browsers */
        }
      },
      resume() {
        try {
          if (recorder.state === 'paused') {
            recorder.resume();
            if (pausedAt) pausedMs += Date.now() - pausedAt;
            pausedAt = 0;
          }
        } catch {
          /* resume is optional on some browsers */
        }
      },
      paused() {
        return recorder.state === 'paused';
      },
      async stop() {
        if (pausedAt) {
          pausedMs += Date.now() - pausedAt;
          pausedAt = 0;
        }
        const durationSeconds = Math.max(0, (Date.now() - startedAt - pausedMs) / 1000);
        const blob = await stopRecorder(recorder, chunks);
        extraStops.forEach((stop) => {
          try {
            stop();
          } catch {
            /* already torn down */
          }
        });
        mic.getTracks().forEach((track) => track.stop());
        speaker?.getTracks().forEach((track) => track.stop());
        if (audioContext) await audioContext.close().catch(() => undefined);
        return { blob, durationSeconds, transcript: '' };
      },
    };
  }

  private makeRecorder(stream: MediaStream): MediaRecorder {
    const mime = preferredMime();
    try {
      return mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      return new MediaRecorder(stream);
    }
  }
}

async function openMicrophone(room = false): Promise<MediaStream> {
  const blocked = microphoneBlockedReason();
  if (blocked) throw new Error(blocked);

  const attempts: MediaStreamConstraints[] = [{ audio: true }];
  if (room) {
    attempts.push({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } else {
    attempts.push({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  }

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getAudioTracks().find((item) => item.readyState !== 'ended') ?? stream.getAudioTracks()[0];
      if (track) {
        if (room) {
          try {
            track.contentHint = 'music';
          } catch {
            /* ignore */
          }
          try {
            await track.applyConstraints({
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            });
          } catch {
            /* ignore */
          }
        }
        return stream;
      }
      stream.getTracks().forEach((item) => item.stop());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No se pudo abrir el micrófono');
}

async function openSpeakerAudio(): Promise<MediaStream | null> {
  if (!navigator.mediaDevices.getDisplayMedia) return null;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 16, height: 16, frameRate: 1 },
      audio: true,
    });
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((track) => track.stop());
      return null;
    }
    return stream;
  } catch {
    return null;
  }
}

function preferredMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

function stopRecorder(recorder: MediaRecorder, chunks: BlobPart[]): Promise<Blob> {
  return new Promise((resolve) => {
    const finish = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    if (recorder.state === 'inactive') {
      finish();
      return;
    }
    const timer = window.setTimeout(finish, 2000);
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () => {
      window.clearTimeout(timer);
      finish();
    };
    recorder.onstop = () => {
      window.clearTimeout(timer);
      finish();
    };
    try {
      if (recorder.state === 'recording') recorder.requestData();
      recorder.stop();
    } catch {
      window.clearTimeout(timer);
      finish();
    }
  });
}

import { Injectable } from '@angular/core';

export interface LiveSession {
  pause(): void;
  resume(): void;
  paused(): boolean;
  stop(): Promise<{ blob: Blob; durationSeconds: number; transcript: string }>;
}

export interface LiveStartOptions {
  internalAudio?: boolean;
  voice?: boolean;
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
    const voice = Boolean(options.voice);
    const mic = await openMicrophone(voice ? 'voice' : options.internalAudio ? 'default' : 'room');
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
    } else if (voice) {
      const cleaned = enhanceVoiceStream(mic);
      if (cleaned) {
        audioContext = cleaned.context;
        recordStream = cleaned.stream;
        extraStops.push(cleaned.stop);
      }
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

async function openMicrophone(mode: 'voice' | 'room' | 'default' = 'default'): Promise<MediaStream> {
  const blocked = microphoneBlockedReason();
  if (blocked) throw new Error(blocked);

  const attempts: MediaStreamConstraints[] =
    mode === 'voice'
      ? [
          { audio: voiceConstraints(true) },
          { audio: voiceConstraints(false) },
          { audio: true },
        ]
      : mode === 'room'
        ? [
            { audio: true },
            { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
          ]
        : [{ audio: true }, { audio: voiceConstraints(false) }];

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getAudioTracks().find((item) => item.readyState !== 'ended') ?? stream.getAudioTracks()[0];
      if (track) {
        try {
          track.contentHint = mode === 'room' ? 'music' : 'speech';
        } catch {
          /* ignore */
        }
        try {
          if (mode === 'room') {
            await track.applyConstraints({
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            });
          } else {
            await track.applyConstraints({
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            });
          }
        } catch {
          /* browser may ignore some processing flags */
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

function voiceConstraints(isolation: boolean): MediaTrackConstraints {
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
  if (isolation) {
    (audio as MediaTrackConstraints & { voiceIsolation?: boolean }).voiceIsolation = true;
  }
  return audio;
}

function enhanceVoiceStream(mic: MediaStream): { context: AudioContext; stream: MediaStream; stop: () => void } | null {
  try {
    const context = new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const source = context.createMediaStreamSource(mic);
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 85;
    highpass.Q.value = 0.7;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -26;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;
    const dest = context.createMediaStreamDestination();
    source.connect(highpass);
    highpass.connect(compressor);
    compressor.connect(dest);
    return {
      context,
      stream: dest.stream,
      stop: () => {
        try {
          source.disconnect();
          highpass.disconnect();
          compressor.disconnect();
        } catch {
          /* already torn down */
        }
        dest.stream.getTracks().forEach((track) => track.stop());
      },
    };
  } catch {
    return null;
  }
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

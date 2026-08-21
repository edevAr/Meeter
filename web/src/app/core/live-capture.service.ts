import { Injectable, NgZone, inject } from '@angular/core';

import { wsUrl } from './config';

export interface LiveSession {
  stop(): Promise<{ blob: Blob; durationSeconds: number; transcript: string }>;
}

export interface LiveStartOptions {
  internalAudio?: boolean;
}

type SpeechEngine = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

@Injectable({ providedIn: 'root' })
export class LiveCaptureService {
  private readonly zone = inject(NgZone);

  async start(onPartial: (text: string) => void, options: LiveStartOptions = {}): Promise<LiveSession> {
    const emit = (text: string) => this.zone.run(() => onPartial(text));
    let lastText = '';
    let locked = '';
    let sessionText = '';
    let whisperText = '';
    let stopped = false;

    const publish = (interim = '') => {
      const speech = appendTranscript(locked, sessionText);
      const committed = appendTranscript(speech, whisperText);
      lastText = committed;
      emit(interim ? appendTranscript(committed, interim) : committed);
    };

    const beginSpeech = () =>
      this.startSpeech(
        (session, interim) => {
          sessionText = session;
          publish(interim);
        },
        () => {
          locked = appendTranscript(locked, sessionText);
          sessionText = '';
        },
        () => stopped,
      );

    let speech: { stop(): void } | null = null;
    if (options.internalAudio) speech = beginSpeech();

    const mic = await openMicrophone(!options.internalAudio);
    const speaker = options.internalAudio ? await openSpeakerAudio() : null;

    const audioContext = new AudioContext();
    if (audioContext.state === 'suspended') void audioContext.resume();
    const keepAudio = window.setInterval(() => {
      if (!stopped && audioContext.state === 'suspended') void audioContext.resume();
    }, 1500);

    const mix = audioContext.createGain();
    const micSource = audioContext.createMediaStreamSource(mic);
    const micGain = audioContext.createGain();
    micGain.gain.value = options.internalAudio ? 1.15 : 4.2;
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = options.internalAudio ? -24 : -34;
    compressor.knee.value = 12;
    compressor.ratio.value = options.internalAudio ? 3 : 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    micSource.connect(micGain);
    micGain.connect(compressor);
    compressor.connect(mix);

    let speakerSource: MediaStreamAudioSourceNode | null = null;
    if (speaker?.getAudioTracks().length) {
      speakerSource = audioContext.createMediaStreamSource(speaker);
      const speakerGain = audioContext.createGain();
      speakerGain.gain.value = 1.7;
      speakerSource.connect(speakerGain);
      speakerGain.connect(mix);
    }

    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silence = audioContext.createGain();
    silence.gain.value = 0;
    const dest = audioContext.createMediaStreamDestination();
    mix.connect(processor);
    mix.connect(dest);
    processor.connect(silence);
    silence.connect(audioContext.destination);

    const pending: ArrayBuffer[] = [];
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let opening = false;
    let probeSeq = 0;
    let sentFrames = 0;
    let sentBytes = 0;
    let lastRms = 0;
    liveLog('start', { internalAudio: !!options.internalAudio, speech: !!speech });
    let socket = connectTranscriptSocket();
    const probeTimer = window.setInterval(() => sendProbe(), 2000);
    window.setTimeout(() => sendProbe(), 400);

    function connectTranscriptSocket(): WebSocket {
      opening = true;
      liveLog('ws connecting', { url: wsUrl('/api/live/transcribe') });
      const next = openTranscriptSocket((payload) => {
        liveLog('recv', payload);
        if (payload.type === 'partial' || payload.type === 'final') {
          const text = payload.text?.trim() ?? '';
          if (text) {
            whisperText = text;
            publish();
          }
        }
      });
      next.onopen = () => {
        opening = false;
        liveLog('ws open', { pending: pending.length });
        while (pending.length && next.readyState === WebSocket.OPEN) {
          next.send(pending.shift() as ArrayBuffer);
        }
        sendProbe();
      };
      next.onerror = (event) => {
        liveLog('ws error', { type: event.type, readyState: next.readyState });
        scheduleReconnect();
      };
      next.onclose = (event) => {
        opening = false;
        liveLog('ws close', { code: event.code, reason: event.reason || '(none)', wasClean: event.wasClean });
        scheduleReconnect();
      };
      return next;
    }

    function scheduleReconnect(): void {
      if (stopped || opening) return;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) return;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      liveLog('ws reconnect scheduled');
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (stopped) return;
        try {
          socket.close();
        } catch {
          /* already closed */
        }
        socket = connectTranscriptSocket();
      }, 280);
    }

    function sendJson(payload: Record<string, unknown>): void {
      if (socket.readyState !== WebSocket.OPEN) {
        liveLog('send skipped', { type: payload['type'], readyState: socket.readyState });
        return;
      }
      liveLog('send', payload);
      socket.send(JSON.stringify(payload));
    }

    function sendProbe(): void {
      if (stopped) return;
      sendJson({
        type: 'probe',
        seq: (probeSeq += 1),
        pcmFrames: sentFrames,
        pcmBytes: sentBytes,
        pending: pending.length,
        rms: Number(lastRms.toFixed(5)),
        socket: socketState(socket),
        audioContext: audioContext.state,
        internalAudio: !!options.internalAudio,
      });
    }

    let lastQueueLog = 0;
    function sendPcm(bytes: ArrayBuffer): void {
      if (stopped) return;
      sentFrames += 1;
      sentBytes += bytes.byteLength;
      lastRms = pcmRms(bytes);
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(bytes);
          return;
        } catch (error) {
          liveLog('send pcm failed', { error: error instanceof Error ? error.message : String(error) });
          pending.push(bytes);
          scheduleReconnect();
          return;
        }
      }
      const now = Date.now();
      if (now - lastQueueLog > 1000) {
        lastQueueLog = now;
        liveLog('pcm queued', { readyState: socketState(socket), pending: pending.length + 1, rms: Number(lastRms.toFixed(5)) });
      }
      if (pending.length >= 80) pending.splice(0, pending.length - 79);
      pending.push(bytes);
      if (socket.readyState !== WebSocket.CONNECTING) scheduleReconnect();
    }

    const recorder = this.makeRecorder(dest.stream);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.start(1000);

    const startedAt = Date.now();
    processor.onaudioprocess = (event) => {
      if (stopped) return;
      const pcm = downsampleTo16k(event.inputBuffer.getChannelData(0), audioContext.sampleRate);
      sendPcm(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
    };

    const stopTracks = () => {
      mic.getTracks().forEach((track) => track.stop());
      speaker?.getTracks().forEach((track) => track.stop());
      dest.stream.getTracks().forEach((track) => track.stop());
    };

    return {
      async stop() {
        locked = appendTranscript(locked, sessionText);
        sessionText = '';
        lastText = appendTranscript(locked, whisperText);
        stopped = true;
        if (reconnectTimer) window.clearTimeout(reconnectTimer);
        window.clearInterval(probeTimer);
        liveLog('stop', { transcript: lastText, pcmFrames: sentFrames, pcmBytes: sentBytes });
        speech?.stop();
        window.clearInterval(keepAudio);
        processor.disconnect();
        micSource.disconnect();
        speakerSource?.disconnect();
        mix.disconnect();
        stopTracks();
        await audioContext.close().catch(() => undefined);
        const durationSeconds = (Date.now() - startedAt) / 1000;
        const blob = await stopRecorder(recorder, chunks);
        if (socket.readyState === WebSocket.OPEN) {
          sendJson({ type: 'stop' });
          await waitClose(socket, 1500);
        } else {
          liveLog('stop without open socket', { readyState: socketState(socket) });
          socket.close();
        }
        return { blob, durationSeconds, transcript: lastText };
      },
    };
  }

  private startSpeech(
    onSession: (finals: string, interim: string) => void,
    onSessionEnd: () => void,
    isStopped: () => boolean,
  ): { stop(): void } | null {
    const Ctor = speechCtor();
    if (!Ctor) return null;
    const recognition = new Ctor() as SpeechEngine;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'es-ES';
    let restartTimer: ReturnType<typeof setTimeout> | null = null;

    const restart = () => {
      onSessionEnd();
      if (isStopped()) return;
      if (restartTimer) window.clearTimeout(restartTimer);
      restartTimer = window.setTimeout(() => {
        if (isStopped()) return;
        try {
          recognition.start();
        } catch {
          restartTimer = window.setTimeout(() => {
            if (isStopped()) return;
            try {
              recognition.start();
            } catch {
              return;
            }
          }, 450);
        }
      }, 120);
    };

    recognition.onresult = (event) => {
      let combined = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const piece = (event.results[i]?.[0]?.transcript ?? '').trim();
        if (!piece) continue;
        if (event.results[i].isFinal) combined = appendTranscript(combined, piece);
        else interim = piece;
      }
      onSession(combined, interim);
    };
    recognition.onerror = (event) => {
      liveLog('speech error', { error: event.error });
      if (event.error === 'not-allowed') return;
    };
    recognition.onend = () => {
      liveLog('speech ended, restart', { stopped: isStopped() });
      restart();
    };
    try {
      recognition.start();
      return {
        stop() {
          if (restartTimer) window.clearTimeout(restartTimer);
          try {
            recognition.stop();
          } catch {
            return;
          }
        },
      };
    } catch {
      return null;
    }
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

function liveLog(event: string, detail?: unknown): void {
  if (detail === undefined) console.log(`[CLIPPY-LIVE] ${event}`);
  else console.log(`[CLIPPY-LIVE] ${event}`, detail);
}

function socketState(socket: WebSocket): string {
  return ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][socket.readyState] ?? String(socket.readyState);
}

function pcmRms(bytes: ArrayBuffer): number {
  const samples = new Int16Array(bytes);
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

function openTranscriptSocket(onMessage: (payload: LiveSocketMessage) => void): WebSocket {
  const socket = new WebSocket(wsUrl('/api/live/transcribe'));
  socket.binaryType = 'arraybuffer';
  socket.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data as string) as LiveSocketMessage);
    } catch {
      liveLog('recv unparseable', { data: String(event.data).slice(0, 120) });
    }
  };
  return socket;
}

type LiveSocketMessage = {
  type?: string;
  text?: string;
  sid?: string;
  seq?: number;
  reason?: string;
  rms?: number;
  chunk?: string;
  last_text?: string;
  pending_seconds?: number;
  busy?: boolean;
  detail?: string;
};

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-záéíóúñü0-9]+/gi) ?? []) as string[];
}

function containsSeq(haystack: string[], needle: string[]): boolean {
  return findSeq(haystack, needle) !== null;
}

function findSeq(haystack: string[], needle: string[]): number | null {
  if (!needle.length || needle.length > haystack.length) return null;
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    let same = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        same = false;
        break;
      }
    }
    if (same) return index;
  }
  return null;
}

function isPrefix(haystack: string[], needle: string[]): boolean {
  if (needle.length > haystack.length) return false;
  for (let i = 0; i < needle.length; i += 1) {
    if (haystack[i] !== needle[i]) return false;
  }
  return true;
}

function suffixPrefixOverlap(left: string[], right: string[]): number {
  for (let count = Math.min(left.length, right.length); count > 0; count -= 1) {
    if (left.slice(-count).join(' ') === right.slice(0, count).join(' ')) return count;
  }
  return 0;
}

function collapseRepeats(words: string[]): string[] {
  let changed = true;
  while (changed && words.length >= 4) {
    changed = false;
    for (let size = Math.floor(words.length / 2); size > 1; size -= 1) {
      for (let index = 0; index + 2 * size <= words.length; index += 1) {
        const left = words.slice(index, index + size).join(' ');
        const right = words.slice(index + size, index + 2 * size).join(' ');
        if (left === right) {
          words = [...words.slice(0, index + size), ...words.slice(index + 2 * size)];
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return words;
}

function usableExtra(prev: string[], extra: string[]): string[] {
  extra = collapseRepeats(extra);
  if (!extra.length) return [];
  if (extra.join(' ') === prev.join(' ') || isPrefix(prev, extra)) return [];
  const recent = prev.slice(-Math.max(extra.length + 12, 40));
  if (containsSeq(recent, extra)) return [];
  return extra;
}

function appendTranscript(previous: string, incoming: string): string {
  const prev = collapseRepeats(tokenize(previous));
  const next = collapseRepeats(tokenize(incoming));
  if (!next.length) return prev.join(' ');
  if (!prev.length) return next.join(' ');
  if (prev.join(' ') === next.join(' ') || (next.length >= 2 && containsSeq(prev, next))) {
    return prev.join(' ');
  }
  if (isPrefix(next, prev)) return next.join(' ');
  if (isPrefix(prev, next)) return prev.join(' ');
  const restatedAt = findSeq(next, prev);
  if (restatedAt !== null) {
    const extra = usableExtra(prev, next.slice(restatedAt + prev.length));
    return extra.length ? collapseRepeats([...prev, ...extra]).join(' ') : prev.join(' ');
  }
  let used = suffixPrefixOverlap(prev, next);
  for (let length = next.length; length > used; length -= 1) {
    if (containsSeq(prev, next.slice(0, length))) {
      used = length;
      break;
    }
  }
  const extra = usableExtra(prev, next.slice(used));
  if (!extra.length) return prev.join(' ');
  return collapseRepeats([...prev, ...extra]).join(' ');
}

async function openMicrophone(room = false): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = room
    ? [
        roomMicConstraints(),
        { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
        { audio: true },
      ]
    : [
        { audio: true },
        { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } },
      ];
  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getAudioTracks().find((item) => item.readyState === 'live' && item.enabled);
      if (track) {
        if (room) {
          prepareRoomTrack(track);
          await relaxVoiceFilters(track, false);
        }
        if (track.readyState === 'live' && !track.muted) return stream;
      }
      stream.getTracks().forEach((item) => item.stop());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No se pudo abrir el micrófono');
}

function roomMicConstraints(): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      voiceIsolation: false,
      googEchoCancellation: false,
      googAutoGainControl: false,
      googNoiseSuppression: false,
      googHighpassFilter: false,
      googTypingNoiseDetection: false,
    } as MediaTrackConstraints,
  };
}

function prepareRoomTrack(track: MediaStreamTrack): void {
  try {
    track.contentHint = 'music';
  } catch {
    return;
  }
}

async function relaxVoiceFilters(track: MediaStreamTrack, voice = true): Promise<void> {
  try {
    await track.applyConstraints({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: voice,
    });
  } catch {
    return;
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

function speechCtor(): (new () => SpeechEngine) | null {
  const root = window as Window & {
    SpeechRecognition?: new () => SpeechEngine;
    webkitSpeechRecognition?: new () => SpeechEngine;
  };
  return root.SpeechRecognition ?? root.webkitSpeechRecognition ?? null;
}

function preferredMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

function downsampleTo16k(input: Float32Array, sampleRate: number): Int16Array {
  const ratio = sampleRate / 16000;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const sample = input[Math.min(input.length - 1, Math.round(i * ratio))] ?? 0;
    const clipped = Math.max(-1, Math.min(1, sample));
    output[i] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
  }
  return output;
}

function stopRecorder(recorder: MediaRecorder, chunks: BlobPart[]): Promise<Blob> {
  return new Promise((resolve) => {
    if (recorder.state === 'inactive') {
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      return;
    }
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    try {
      recorder.stop();
    } catch {
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    }
  });
}

function waitClose(socket: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      socket.close();
      resolve();
    }, timeoutMs);
    socket.onclose = () => {
      window.clearTimeout(timer);
      resolve();
    };
  });
}

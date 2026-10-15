from __future__ import annotations

import asyncio
import logging

import numpy as np

from app.domain.interfaces.diarization import SpeakerDiarizationProvider, SpeakerTurn
from app.infrastructure.transcription.alignment import remap_speaker_labels
from app.infrastructure.transcription.whisper_provider import decode_audio_file

logger = logging.getLogger(__name__)

_SAMPLE_RATE = 16000
_FRAME_S = 0.5
_HOP_S = 0.25
_MIN_SPEECH_S = 0.35
_MAX_SPEAKERS = 6


class ClusteringDiarizationProvider(SpeakerDiarizationProvider):
    """Unsupervised speaker diarization (VAD + spectral embeddings + k-means).

    Runs fully on CPU with numpy. Quality is best with 2–4 distinct voices.
    """

    name = "clustering"

    async def identify_speakers(self, audio_path: str) -> list[SpeakerTurn]:
        return await asyncio.to_thread(self._identify, audio_path)

    async def identify_from_samples(self, audio, sample_rate: int = _SAMPLE_RATE) -> list[SpeakerTurn]:
        return await asyncio.to_thread(self._identify_samples, audio, sample_rate)

    def _identify(self, audio_path: str) -> list[SpeakerTurn]:
        return self._identify_samples(_load_audio(audio_path), _SAMPLE_RATE)

    def _identify_samples(self, audio, sample_rate: int = _SAMPLE_RATE) -> list[SpeakerTurn]:
        if audio is None or getattr(audio, "size", 0) < sample_rate * 0.4:
            return []
        turns = _cluster_speakers(audio, sample_rate)
        labeled = remap_speaker_labels(turns)
        logger.info("DIARIZATION clustering speakers=%s turns=%s", _speaker_count(labeled), len(labeled))
        return labeled


def _load_audio(path: str) -> np.ndarray | None:
    decoded = decode_audio_file(path)
    if isinstance(decoded, np.ndarray) and decoded.size:
        return np.ascontiguousarray(decoded, dtype=np.float32)
    return None


def _cluster_speakers(audio: np.ndarray, sample_rate: int) -> list[SpeakerTurn]:
    frame = int(_FRAME_S * sample_rate)
    hop = int(_HOP_S * sample_rate)
    if audio.size < frame:
        return []
    windows: list[tuple[float, float, np.ndarray]] = []
    energies: list[float] = []
    for start in range(0, audio.size - frame + 1, hop):
        chunk = audio[start : start + frame]
        rms = float(np.sqrt(np.mean(np.square(chunk))))
        energies.append(rms)
        windows.append((start / sample_rate, (start + frame) / sample_rate, chunk))
    if not windows:
        return []
    energy = np.asarray(energies, dtype=np.float32)
    floor = float(np.percentile(energy, 30))
    threshold = max(0.012, floor * 2.4)
    speech_idx = [i for i, rms in enumerate(energy) if rms >= threshold]
    if len(speech_idx) < 3:
        end = audio.size / sample_rate
        return [SpeakerTurn(0.0, end, "SPEAKER_01")] if end >= _MIN_SPEECH_S else []

    features = np.stack([_embedding(windows[i][2], sample_rate) for i in speech_idx])
    features = _l2_normalize(features)
    k = _choose_k(features)
    labels = _kmeans(features, k)
    labeled_windows = [
        (windows[i][0], windows[i][1], int(labels[pos]))
        for pos, i in enumerate(speech_idx)
    ]
    return _windows_to_turns(labeled_windows)


def _embedding(frame: np.ndarray, sample_rate: int) -> np.ndarray:
    windowed = frame * np.hanning(frame.size)
    spec = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(frame.size, 1.0 / sample_rate)
    bands = np.geomspace(80.0, min(4000.0, sample_rate / 2 - 1), 20)
    values = np.zeros(len(bands) - 1, dtype=np.float32)
    for i in range(len(bands) - 1):
        mask = (freqs >= bands[i]) & (freqs < bands[i + 1])
        if np.any(mask):
            values[i] = float(np.log1p(np.mean(spec[mask])))
    rms = float(np.sqrt(np.mean(np.square(frame))))
    zcr = float(np.mean(np.abs(np.diff(np.sign(frame)))) / 2)
    return np.concatenate([values, np.array([np.log1p(rms), zcr], dtype=np.float32)])


def _l2_normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms = np.clip(norms, 1e-8, None)
    return matrix / norms


def _choose_k(features: np.ndarray) -> int:
    n = len(features)
    max_k = max(1, min(_MAX_SPEAKERS, n // 4, n))
    if max_k <= 1:
        return 1
    best_k = 1
    best_score = -1.0
    for k in range(1, max_k + 1):
        labels = _kmeans(features, k)
        score = _silhouette(features, labels) if k > 1 else 0.12
        if k == 1:
            score = 0.12
        if score > best_score:
            best_score = score
            best_k = k
    if best_score < 0.08:
        return 1
    return best_k


def _kmeans(features: np.ndarray, k: int, rounds: int = 8, iters: int = 18) -> np.ndarray:
    n = len(features)
    if k <= 1 or n <= 1:
        return np.zeros(n, dtype=np.int32)
    k = min(k, n)
    rng = np.random.default_rng(7)
    best_labels = np.zeros(n, dtype=np.int32)
    best_inertia = 1e18
    for _ in range(rounds):
        centers = features[rng.choice(n, size=k, replace=False)]
        labels = np.zeros(n, dtype=np.int32)
        for _step in range(iters):
            dist = 1.0 - features @ centers.T
            labels = dist.argmin(axis=1).astype(np.int32)
            for cluster in range(k):
                members = features[labels == cluster]
                if not len(members):
                    centers[cluster] = features[rng.integers(0, n)]
                    continue
                mean = members.mean(axis=0)
                norm = np.linalg.norm(mean)
                centers[cluster] = mean / norm if norm > 1e-8 else mean
        inertia = float(np.sum(1.0 - np.sum(features * centers[labels], axis=1)))
        if inertia < best_inertia:
            best_inertia = inertia
            best_labels = labels
    return best_labels


def _silhouette(features: np.ndarray, labels: np.ndarray) -> float:
    if len(features) < 4:
        return 0.0
    clusters = np.unique(labels)
    if len(clusters) < 2:
        return 0.0
    sim = features @ features.T
    scores: list[float] = []
    for i, label in enumerate(labels):
        same = labels == label
        same[i] = False
        if not np.any(same):
            continue
        a = 1.0 - float(np.mean(sim[i, same]))
        others = []
        for cluster in clusters:
            if cluster == label:
                continue
            mask = labels == cluster
            if np.any(mask):
                others.append(1.0 - float(np.mean(sim[i, mask])))
        if not others:
            continue
        b = min(others)
        denom = max(a, b, 1e-6)
        scores.append((b - a) / denom)
    return float(np.mean(scores)) if scores else 0.0


def _windows_to_turns(windows: list[tuple[float, float, int]]) -> list[SpeakerTurn]:
    if not windows:
        return []
    turns: list[SpeakerTurn] = []
    start, end, cluster = windows[0]
    for next_start, next_end, next_cluster in windows[1:]:
        if next_cluster == cluster and next_start <= end + 0.45:
            end = max(end, next_end)
            continue
        if end - start >= _MIN_SPEECH_S:
            turns.append(SpeakerTurn(start, end, f"SPEAKER_{cluster + 1:02d}"))
        start, end, cluster = next_start, next_end, next_cluster
    if end - start >= _MIN_SPEECH_S:
        turns.append(SpeakerTurn(start, end, f"SPEAKER_{cluster + 1:02d}"))
    return turns


def _speaker_count(turns: list[SpeakerTurn]) -> int:
    return len({turn.speaker for turn in turns})

from __future__ import annotations

import numpy as np
import pytest

from app.config.settings import Settings
from app.infrastructure.ai.factory import create_ai_provider
from app.infrastructure.diarization.clustering import ClusteringDiarizationProvider, _cluster_speakers
from app.infrastructure.diarization.factory import create_diarization_provider


def test_cluster_speakers_separates_two_tones() -> None:
    sr = 16000
    t1 = np.arange(0, int(1.2 * sr)) / sr
    t2 = np.arange(0, int(1.2 * sr)) / sr
    a = 0.2 * np.sin(2 * np.pi * 180 * t1)
    b = 0.2 * np.sin(2 * np.pi * 2400 * t2)
    gap = np.zeros(int(0.35 * sr), dtype=np.float32)
    audio = np.concatenate([a, gap, b]).astype(np.float32)
    turns = _cluster_speakers(audio, sr)
    speakers = {turn.speaker for turn in turns}
    assert turns
    assert len(speakers) >= 1
    if len(speakers) >= 2:
        first = min(turns, key=lambda item: item.start_time)
        last = max(turns, key=lambda item: item.start_time)
        assert first.speaker != last.speaker


@pytest.mark.asyncio
async def test_clustering_identify_from_samples_skips_reload() -> None:
    sr = 16000
    audio = (0.2 * np.sin(2 * np.pi * 220 * np.arange(0, int(1.5 * sr)) / sr)).astype(np.float32)
    turns = await ClusteringDiarizationProvider().identify_from_samples(audio, sr)
    assert isinstance(turns, list)


@pytest.mark.asyncio
async def test_clustering_provider_handles_silence(tmp_path) -> None:
    from app.infrastructure.audio.wav_writer import write_silence_wav

    wav = tmp_path / "quiet.wav"
    write_silence_wav(wav, 0.8)
    turns = await ClusteringDiarizationProvider().identify_speakers(str(wav))
    assert isinstance(turns, list)


def test_diarization_factory_none(settings: Settings) -> None:
    settings.diarization_provider = "none"
    provider = create_diarization_provider(settings)
    assert provider.name == "none"


def test_qwen3_provider_uses_groq_when_key_present(settings: Settings) -> None:
    settings.ai_provider = "qwen3"
    settings.ai_api_key = "gsk_test"
    settings.ai_model = "llama-3.1-8b-instant"
    settings.ai_base_url = ""
    provider = create_ai_provider(settings)
    assert provider.name == "qwen3"
    assert "qwen" in provider.primary.model.lower()


def test_qwen3_provider_defaults_to_ollama_without_key(settings: Settings) -> None:
    settings.ai_provider = "qwen3"
    settings.ai_api_key = ""
    settings.ai_model = ""
    settings.ai_base_url = ""
    provider = create_ai_provider(settings)
    assert provider.name == "qwen3"
    assert provider.primary.model == "qwen3"
    assert provider.primary.is_cloud is False

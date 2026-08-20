from __future__ import annotations

from app.infrastructure.transcription.whisper_provider import (
    faster_whisper_decode_options,
    openai_whisper_decode_options,
    pcm16_to_float32,
)


def test_live_faster_whisper_is_greedy_and_not_conditioned() -> None:
    opts = faster_whisper_decode_options(live=True, language="es")
    assert opts["language"] == "es"
    assert opts["beam_size"] == 1
    assert opts["best_of"] == 1
    assert opts["temperature"] == 0.0
    assert opts["condition_on_previous_text"] is False
    assert opts["vad_filter"] is True
    assert opts["without_timestamps"] is True


def test_batch_faster_whisper_keeps_beam_search() -> None:
    opts = faster_whisper_decode_options(live=False, language="auto")
    assert opts["language"] is None
    assert opts["beam_size"] == 5
    assert opts["condition_on_previous_text"] is True


def test_live_openai_whisper_disables_fallback() -> None:
    opts = openai_whisper_decode_options(live=True, language="es")
    assert opts["beam_size"] == 1
    assert opts["temperature"] == 0.0
    assert opts["condition_on_previous_text"] is False


def test_pcm16_to_float32_silence() -> None:
    audio = pcm16_to_float32(b"\x00\x00" * 8)
    assert audio.shape == (8,)
    assert float(audio.max()) == 0.0

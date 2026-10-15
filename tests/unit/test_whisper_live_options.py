from __future__ import annotations

from app.infrastructure.transcription.whisper_provider import (
    _preview,
    extract_percent,
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
    assert opts["vad_filter"] is False
    assert opts["chunk_length"] == 30
    assert opts["max_new_tokens"] == 224
    assert opts["without_timestamps"] is True


def test_batch_faster_whisper_skips_timestamp_tokens() -> None:
    opts = faster_whisper_decode_options(live=False, language="auto")
    assert opts["without_timestamps"] is True
    assert opts["word_timestamps"] is False


def test_batch_faster_whisper_stays_greedy_on_cpu() -> None:
    opts = faster_whisper_decode_options(live=False, language="auto")
    assert opts["language"] is None
    assert opts["beam_size"] == 1
    assert opts["best_of"] == 1
    assert opts["condition_on_previous_text"] is False
    assert opts["vad_filter"] is False
    assert opts["chunk_length"] == 30


def test_live_openai_whisper_disables_fallback() -> None:
    opts = openai_whisper_decode_options(live=True, language="es")
    assert opts["beam_size"] == 1
    assert opts["temperature"] == 0.0
    assert opts["condition_on_previous_text"] is False


def test_pcm16_to_float32_silence() -> None:
    audio = pcm16_to_float32(b"\x00\x00" * 8)
    assert audio.shape == (8,)
    assert float(audio.max()) == 0.0


def test_extract_percent_and_preview() -> None:
    assert extract_percent(0, 60) == 0
    assert extract_percent(30, 60) == 50
    assert extract_percent(60, 60) == 100
    assert extract_percent(90, 60) == 100
    assert extract_percent(10, 0) == 0
    assert _preview("hola   mundo") == "hola mundo"
    assert "…" in _preview("x" * 80)
    assert len(_preview("x" * 80)) == 48

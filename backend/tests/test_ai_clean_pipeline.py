from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from AI.artifacts import publish_files_atomically
from AI.engines.text import Qwen3ForcedAligner, resolve_alignment_language, tokenize
from AI.lyrics_sources import TimedLine
from AI.models import PitchFrame, Word
from AI.pipeline import KaraokePipeline, PipelineRequest


class Separator:
    name = "test-separator"

    @staticmethod
    def separate(mix, vocals, instrumental, *, profile=None):
        audio, rate = sf.read(mix, dtype="float32", always_2d=True)
        sf.write(vocals, audio, rate)
        sf.write(instrumental, audio * 0, rate)

    @staticmethod
    def close():
        return None


class Pitch:
    name = "test-pitch"

    @staticmethod
    def estimate(_audio):
        return [PitchFrame(time / 100, 440, 1, True) for time in range(100, 151)]


class Aligner:
    name = "test-aligner"

    @staticmethod
    def align_long_text(_audio, text, _language):
        return [Word(1, 1.6, text, index=0)]


def test_clean_pipeline_publishes_only_canonical_runtime_artifacts(tmp_path, monkeypatch):
    source, lyrics, output = tmp_path / "source.wav", tmp_path / "lyrics.txt", tmp_path / "out"
    sf.write(source, np.zeros((44100 * 2, 2), dtype=np.float32), 44100)
    lyrics.write_text("hello", encoding="utf-8")
    monkeypatch.setattr("AI.pipeline.analyze_music", lambda _path: {"bpm": 120, "key": "A minor"})
    engines = SimpleNamespace(
        separator=Separator(), pitch=Pitch(), transcriber=None, aligner=Aligner()
    )

    result = KaraokePipeline(engines=engines).run(PipelineRequest(source, output, lyrics_path=lyrics))

    assert result.manifest_path == output / "lyricsSync.json"
    assert {path.name for path in output.iterdir()} == {
        "instrumental.flac",
        "lyricsSync.json",
        "vocals.flac",
    }
    assert sf.info(output / "vocals.flac").channels == 1


def test_atomic_publish_restores_every_previous_artifact(tmp_path, monkeypatch):
    sources = [tmp_path / f"new-{index}" for index in range(2)]
    targets = [tmp_path / f"target-{index}" for index in range(2)]
    for index, path in enumerate(sources):
        path.write_text(f"new-{index}", encoding="utf-8")
    for index, path in enumerate(targets):
        path.write_text(f"old-{index}", encoding="utf-8")
    real_replace = __import__("os").replace

    def fail_second_publish(source, target):
        if source == sources[1] and target == targets[1]:
            raise OSError("disk failure")
        real_replace(source, target)

    monkeypatch.setattr("AI.artifacts.os.replace", fail_second_publish)

    with pytest.raises(OSError, match="disk failure"):
        publish_files_atomically(list(zip(sources, targets, strict=True)))

    assert [path.read_text(encoding="utf-8") for path in targets] == ["old-0", "old-1"]


def test_lyrics_tokens_match_qwen_space_language_contract():
    assert tokenize("Ты станешь слаще —\nА я, кто-то…") == [
        "Ты", "станешь", "слаще", "А", "я", "кто-то"
    ]
    assert resolve_alignment_language("текст", "ru-RU") == "Russian"
    assert resolve_alignment_language("український текст") == "Ukrainian"


def test_forced_aligner_does_not_expect_timestamps_for_punctuation(monkeypatch):
    text = "Ты станешь слаще —\nА я"
    items = [
        {"text": token.replace("-", ""), "start_time": index, "end_time": index + 0.5}
        for index, token in enumerate(tokenize(text))
    ]
    model = SimpleNamespace(align=lambda **_kwargs: [SimpleNamespace(items=items)])
    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = model
    monkeypatch.setattr("AI.engines.text.duration", lambda _audio: 10)

    words = aligner.align("vocals.flac", text, "ru")

    assert [word.text for word in words] == ["Ты", "станешь", "слаще", "А", "я"]


def test_long_alignment_realigns_collapsed_ranges_acoustically(tmp_path, monkeypatch):
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(44100 * 5, dtype=np.float32), 44100)
    collapsed = [
        {"text": token, "start_time": start, "end_time": end}
        for token, start, end in [
            ("one", 0.2, 0.8), ("two", 1, 1), ("three", 1, 1), ("four", 3, 3.6)
        ]
    ]
    repaired = [
        {"text": token, "start_time": index * 0.8, "end_time": index * 0.8 + 0.4}
        for index, token in enumerate(("one", "two", "three", "four"))
    ]

    def align(audio, **_kwargs):
        return [SimpleNamespace(items=repaired if isinstance(audio, tuple) else collapsed)]

    model = SimpleNamespace(align=lambda audio, **kwargs: (
        [SimpleNamespace(items=repaired)] if isinstance(audio, list) else align(audio, **kwargs)
    ))
    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = model

    words = aligner.align_long_text(audio, "one two three four", "en")

    assert [(round(word.start, 3), round(word.end, 3)) for word in words] == [
        (0, 0.4), (0.8, 1.2), (1.6, 2), (2.4, 2.8)
    ]


def test_timed_lines_only_define_acoustic_windows(tmp_path):
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(44100 * 4, dtype=np.float32), 44100)
    items = [
        {"text": token, "start_time": index, "end_time": index + 0.5}
        for index, token in enumerate(("one", "two", "three"))
    ]
    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = SimpleNamespace(
        align=lambda **_kwargs: [SimpleNamespace(items=items)]
    )

    words = aligner.align_timed_lines(
        audio, "one two\nthree", (TimedLine(0, "one two"), TimedLine(2, "three")), "en"
    )

    assert [word.text for word in words] == ["one", "two", "three"]


def test_isolated_collapsed_word_uses_remaining_interval_between_acoustic_anchors(tmp_path):
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(44100 * 4, dtype=np.float32), 44100)
    items = [
        {"text": "one", "start_time": 0.2, "end_time": 0.8},
        {"text": "two", "start_time": 1, "end_time": 1},
        {"text": "three", "start_time": 1.4, "end_time": 2},
    ]
    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = SimpleNamespace(
        align=lambda audio, **_kwargs: [SimpleNamespace(items=items) for _ in audio]
    )

    words = aligner.align_timed_lines(
        audio, "one two three", (TimedLine(0, "one two three"),), "en"
    )

    assert (words[1].start, words[1].end) == (0.8, 1.4)


def test_collapsed_consonant_preposition_uses_one_model_time_quantum(tmp_path):
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(44100 * 3, dtype=np.float32), 44100)
    items = [
        {"text": "sing", "start_time": 0.2, "end_time": 1},
        {"text": "в", "start_time": 1, "end_time": 1},
        {"text": "городе", "start_time": 1, "end_time": 2},
    ]
    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = SimpleNamespace(
        timestamp_segment_time=80,
        align=lambda audio, **_kwargs: [SimpleNamespace(items=items) for _ in audio],
    )

    words = aligner.align_timed_lines(
        audio, "sing в городе", (TimedLine(0, "sing в городе"),), "ru"
    )

    assert (round(words[1].start, 2), round(words[1].end, 2), round(words[2].start, 2)) == (1, 1.08, 1.08)

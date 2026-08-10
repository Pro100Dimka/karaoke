import numpy as np
import pytest

from AI.engines import text as text_engine
from AI.engines.text import (
    Qwen3ForcedAligner,
    _activity_fallback_words,
    _group_lyric_text,
    _pathological_alignment,
    _trim_transcript_overlaps,
)
from AI.models import Word


def test_overlapping_transcript_parts_keep_owned_phrase_text():
    parts = _trim_transcript_overlaps(
        ["we sing this song", "this song together now", "together now again"]
    )

    assert parts == ["we sing this song", "together now", "again"]


def test_segmented_aligner_offsets_short_phrase_timings(monkeypatch):
    monkeypatch.setattr(
        text_engine,
        "load_mono",
        lambda _audio, _sample_rate: (np.zeros(16_000 * 5, dtype=np.float32), 16_000),
    )
    aligner = Qwen3ForcedAligner("unused")

    def fake_align(_path, phrase, _language):
        tokens = phrase.split()
        return [
            Word(index * 0.2, index * 0.2 + 0.16, token, 0.9, index)
            for index, token in enumerate(tokens)
        ]

    monkeypatch.setattr(aligner, "align", fake_align)
    words = aligner.align_segments(
        "song.wav",
        [(1.0, 2.0, "first line"), (3.0, 4.0, "second")],
        "English",
    )

    assert [word.text for word in words] == ["first", "line", "second"]
    assert [word.index for word in words] == [0, 1, 2]
    assert words[0].start == 1.0
    assert words[1].end == pytest.approx(1.36)
    assert words[2].start == 3.0
    assert all(left.end <= right.start for left, right in zip(words, words[1:], strict=False))


def test_trusted_lyrics_preserve_author_lines_exactly():
    source = (
        "one two three four five\n"
        "six seven eight nine ten\n"
        "eleven twelve thirteen fourteen fifteen"
    )

    assert _group_lyric_text(source) == source.splitlines()


def test_many_author_lines_are_never_repacked():
    lines = ["one two three four five"] * 8

    assert _group_lyric_text("\n".join(lines)) == lines


def test_unstructured_single_line_is_chunked_below_model_context_limit():
    source = " ".join(["word"] * 40)

    groups = _group_lyric_text(source)

    assert [len(group.split()) for group in groups] == [35, 5]


def test_alignment_context_collapse_is_rejected():
    words = [
        Word(0.0, 0.02, "one", 1.0, 0),
        Word(0.02, 0.04, "two", 1.0, 1),
        Word(0.04, 9.5, "three", 1.0, 2),
        Word(9.5, 9.52, "four", 1.0, 3),
    ]

    assert _pathological_alignment(words, 10.0)


def test_alignment_with_many_implausibly_short_words_is_rejected():
    words = [
        Word(0.00, 0.56, "сказав", 1.0, 0),
        Word(0.56, 0.72, "що", 1.0, 1),
        Word(0.72, 1.12, "більш", 1.0, 2),
        Word(1.12, 1.20, "такої", 1.0, 3),
    ]

    assert _pathological_alignment(words, 2.0)


def test_alignment_rejects_a_complete_line_compressed_into_one_burst():
    words = [
        Word(index * 0.04, index * 0.04 + 0.04, token, 1.0, index)
        for index, token in enumerate("one complete lyric line here".split())
    ]

    assert _pathological_alignment(words, 8.0)


def test_rejected_alignment_falls_back_inside_nearest_vocal_region():
    sample_rate = 1000
    audio = np.zeros(sample_rate * 4, dtype=np.float32)
    audio[500:1100] = 0.8
    audio[2800:3700] = 0.8
    hint = [Word(2.9, 3.1, "next", 1.0, 0)]

    words = _activity_fallback_words(
        ["sing", "now"], audio, sample_rate, hint
    )

    assert words[0].start >= 2.7
    assert words[-1].end <= 3.8


def test_activity_fallback_never_reuses_a_previous_phrase_region():
    sample_rate = 1000
    audio = np.zeros(sample_rate * 4, dtype=np.float32)
    audio[500:1300] = 0.8
    audio[2400:3300] = 0.8
    misleading_hint = [Word(0.7, 1.0, "old", 1.0, 0)]

    words = _activity_fallback_words(
        ["new", "line"],
        audio,
        sample_rate,
        misleading_hint,
        minimum_start=1.5,
    )

    assert words[0].start >= 2.3


def test_activity_fallback_uses_all_islands_in_one_sung_phrase():
    sample_rate = 1000
    audio = np.zeros(sample_rate * 5, dtype=np.float32)
    audio[500:1100] = 0.8
    audio[1500:2200] = 0.8
    audio[2600:3400] = 0.8
    misleading_collapsed_hint = [Word(0.55, 0.70, "collapsed", 1.0, 0)]

    words = _activity_fallback_words(
        ["complete", "lyric", "line"], audio, sample_rate, misleading_collapsed_hint
    )

    assert words[0].start < 0.7
    assert words[-1].end > 3.1
    assert all(word.end - word.start >= 0.02 for word in words)


def test_synced_segment_fallback_never_collapses_whole_line(monkeypatch):
    monkeypatch.setattr(
        text_engine,
        "load_mono",
        lambda _audio, _sample_rate: (np.zeros(16_000 * 10, dtype=np.float32), 16_000),
    )
    aligner = Qwen3ForcedAligner("unused")

    def collapsed(_path, phrase, _language):
        tokens = phrase.split()
        return [
            Word(index * 0.02, index * 0.02 + 0.02, token, 0.05, index)
            for index, token in enumerate(tokens)
        ]

    monkeypatch.setattr(aligner, "align", collapsed)
    words = aligner.align_segments(
        "song.wav",
        [(2.0, 8.0, "Пропал без вести в японских лагерях")],
        "Russian",
    )

    assert words[0].start == pytest.approx(2.0)
    assert words[-1].end - words[0].start > 2.0
    assert words[-1].end <= 8.0
    assert all(word.end - word.start >= 0.02 for word in words)


def test_segmented_aligner_rejects_valid_durations_outside_lrc_window(monkeypatch):
    monkeypatch.setattr(
        text_engine,
        "load_mono",
        lambda _audio, _sample_rate: (np.zeros(16_000 * 12, dtype=np.float32), 16_000),
    )
    aligner = Qwen3ForcedAligner("unused")

    def wrong_context(_path, phrase, _language):
        tokens = phrase.split()
        # Durations look realistic, but timestamps belong to a different chunk.
        return [
            Word(8.0 + index * 0.4, 8.3 + index * 0.4, token, 0.95, index)
            for index, token in enumerate(tokens)
        ]

    monkeypatch.setattr(aligner, "align", wrong_context)
    words = aligner.align_segments(
        "song.wav",
        [(2.0, 7.0, "Пропал без вести в японских лагерях")],
        "Russian",
    )

    assert words[0].start == pytest.approx(2.0)
    assert words[-1].end <= 7.0
    assert words[-1].end - words[0].start > 2.0
    assert not any(word.end - word.start <= 0.025 for word in words)


def test_segmented_aligner_skips_segments_after_audio_duration(monkeypatch):
    monkeypatch.setattr(
        text_engine,
        "load_mono",
        lambda _audio, _sample_rate: (np.zeros(16_000 * 5, dtype=np.float32), 16_000),
    )
    aligner = Qwen3ForcedAligner("unused")
    monkeypatch.setattr(
        aligner,
        "align",
        lambda _path, phrase, _language: [Word(0.0, 0.5, phrase, 0.9, 0)],
    )

    words = aligner.align_segments(
        "song.wav",
        [(1.0, 2.0, "inside"), (5.5, 6.5, "outside")],
        "English",
    )

    assert [word.text for word in words] == ["inside"]
    assert words[0].end <= 5.0


def test_production_corrupt_lrc_boundary_is_soft_and_does_not_compress_line(monkeypatch):
    """Regression from TRITIA: 6 words had a ~0.44 s provider interval."""
    monkeypatch.setattr(
        text_engine,
        "load_mono",
        lambda _audio, _sample_rate: (np.zeros(16_000 * 40, dtype=np.float32), 16_000),
    )
    aligner = Qwen3ForcedAligner("unused")

    def acoustic_alignment(_path, phrase, _language):
        tokens = phrase.split()
        if phrase.startswith("Пропал без"):
            # The real phrase is found after the broken 23.79->24.23 LRC crop.
            base = 1.35
            return [
                Word(base + index * 0.31, base + index * 0.31 + 0.26, token, 0.94, index)
                for index, token in enumerate(tokens)
            ]
        return [Word(7.2 + index * 0.45, 7.55 + index * 0.45, token, 0.9, index)
                for index, token in enumerate(tokens)]

    monkeypatch.setattr(aligner, "align", acoustic_alignment)
    words = aligner.align_segments(
        "song.wav",
        [
            (23.79, 24.23, "Пропал без вести в японских лагерях"),
            (24.25, 35.76, "Пропал голубем синицею в руке"),
        ],
        "Russian",
    )

    first = words[:6]
    second = words[6:]
    assert first[-1].end - first[0].start >= 1.5
    assert first[-1].end > 24.23  # never clamp back to the broken provider end
    assert second[0].start >= first[-1].end
    assert not any(word.end - word.start <= 0.025 for word in words)


def test_production_fallback_for_corrupt_lrc_boundary_has_physical_duration(monkeypatch):
    sample_rate = 16_000
    audio = np.zeros(sample_rate * 35, dtype=np.float32)
    # Real vocal activity following the bad 23.79 timestamp.
    audio[int(23.55 * sample_rate):int(25.10 * sample_rate)] = 0.8
    monkeypatch.setattr(text_engine, "load_mono", lambda _audio, _sample_rate: (audio, sample_rate))
    aligner = Qwen3ForcedAligner("unused")

    def collapsed(_path, phrase, _language):
        return [
            Word(index * 0.02, index * 0.02 + 0.02, token, 0.05, index)
            for index, token in enumerate(phrase.split())
        ]

    monkeypatch.setattr(aligner, "align", collapsed)
    words = aligner.align_segments(
        "song.wav",
        [(23.79, 24.23, "Пропал без вести в японских лагерях")],
        "Russian",
    )

    assert words[-1].end - words[0].start >= 1.0
    assert words[-1].end > 24.23
    assert all(word.end - word.start > 0.025 for word in words)


def test_real_tritia_failure_shape_does_not_recollapse_to_first_energy_island(monkeypatch):
    """Exact v4 production shape: bad 23.79->24.23 line + short local vocal island."""
    sample_rate = 16_000
    audio = np.zeros(sample_rate * 40, dtype=np.float32)
    # This short island mirrors the real separated vocal around the broken anchor.
    audio[int(23.56 * sample_rate):int(24.60 * sample_rate)] = 0.8
    # Later phrase activity must not matter to the corrupt-line fallback.
    audio[int(31.98 * sample_rate):int(35.80 * sample_rate)] = 0.8
    monkeypatch.setattr(text_engine, "load_mono", lambda _audio, _sample_rate: (audio, sample_rate))
    aligner = Qwen3ForcedAligner("unused")

    def collapsed(_path, phrase, _language):
        # What the failing production aligner effectively produced: six words
        # squeezed into the bad provider interval.
        tokens = phrase.split()
        return [
            Word(index * 0.02, index * 0.02 + 0.02, token, 0.05, index)
            for index, token in enumerate(tokens)
        ]

    monkeypatch.setattr(aligner, "align", collapsed)
    words = aligner.align_segments(
        "song.wav",
        [(23.79, 24.23, "Пропал без вести в японских лагерях")],
        "Russian",
    )

    assert words[0].start == pytest.approx(23.79)
    assert words[-1].end >= 26.0
    assert words[-1].end - words[0].start >= 2.5
    assert not any(word.end - word.start <= 0.025 for word in words)


def test_long_text_collapsed_qwen_line_uses_candidate_start_but_not_candidate_duration(monkeypatch):
    monkeypatch.setenv("KARAOKE_AI_REQUIRE_CTC", "0")
    sample_rate = 16_000
    audio = np.zeros(sample_rate * 50, dtype=np.float32)
    monkeypatch.setattr(text_engine, "load_mono", lambda _audio, _sample_rate: (audio, sample_rate))
    aligner = Qwen3ForcedAligner("unused")

    calls = {"n": 0}
    def collapsed(_path, phrase, _language):
        calls["n"] += 1
        tokens = phrase.split()
        base = 3.0 if calls["n"] == 1 else 1.0
        return [Word(base + i * 0.02, base + i * 0.02 + 0.02, t, 0.05, i) for i, t in enumerate(tokens)]

    monkeypatch.setattr(aligner, "align", collapsed)
    words = aligner.align_long_text(
        "song.wav",
        "Пропал без вести в японских лагерях\nСледующая строка песни",
        "Russian",
    )
    first = words[:6]
    assert first[0].start == pytest.approx(3.0)
    assert first[-1].end - first[0].start >= 2.5
    assert not any(w.end - w.start <= 0.025 for w in first)


def test_long_text_empty_qwen_does_not_abort_pipeline(monkeypatch):
    monkeypatch.setenv("KARAOKE_AI_REQUIRE_CTC", "0")
    sample_rate = 16_000
    audio = np.zeros(sample_rate * 12, dtype=np.float32)
    # Two sung regions so the activity-envelope fallback has real timing anchors.
    audio[sample_rate * 1:sample_rate * 5] = 0.15
    audio[sample_rate * 6:sample_rate * 10] = 0.12
    monkeypatch.setattr(text_engine, "load_mono", lambda _audio, _sample_rate: (audio, sample_rate))
    aligner = Qwen3ForcedAligner("unused")
    monkeypatch.setattr(aligner, "align", lambda *_args, **_kwargs: [])

    words = aligner.align_long_text(
        "song.wav",
        "Первая строка песни здесь\nВторая строка песни тоже",
        "Russian",
    )

    assert len(words) == 8
    assert words[0].start >= 0.0
    assert words[-1].end <= 12.0
    assert all(right.start >= left.end - 1e-6 for left, right in zip(words, words[1:]))
    assert all(word.end > word.start for word in words)
    assert all(word.confidence <= 0.03 for word in words)


def test_asr_global_anchor_maps_repeated_lyrics_monotonically():
    groups = ["hello world", "repeat chorus", "repeat chorus", "final line"]
    segments = [
        (1.0, 5.0, "hello world"),
        (10.0, 15.0, "repeat chorus"),
        (30.0, 35.0, "repeat chorus"),
        (40.0, 45.0, "final line"),
    ]
    anchors = text_engine._asr_line_anchor_windows(groups, segments)
    assert anchors[0][0] < anchors[1][0] < anchors[2][0] < anchors[3][0]
    assert anchors[2][0] > 25.0


def test_long_text_uses_asr_anchor_to_skip_wrong_early_occurrence(monkeypatch):
    monkeypatch.setattr(
        text_engine,
        "load_mono",
        lambda _audio, _sample_rate: (np.zeros(16_000 * 50, dtype=np.float32), 16_000),
    )
    aligner = Qwen3ForcedAligner("unused")
    aligner.set_global_asr_segments([(25.0, 31.0, "target lyric line")])
    seen = []

    def fake_align(path, phrase, _language):
        import soundfile as sf
        seen.append(sf.info(path).duration)
        tokens = phrase.split()
        return [Word(i * 0.45, i * 0.45 + 0.35, token, 0.9, i) for i, token in enumerate(tokens)]

    monkeypatch.setattr(aligner, "align", fake_align)
    words = aligner.align_long_text("song.wav", "target lyric line\n" + "other words here " * 25, "English")
    assert words
    # The target line should be searched near the 25s ASR anchor, not at song start.
    assert words[0].start > 20.0


def test_long_text_never_drops_canonical_tail_when_local_pass_reaches_eof(monkeypatch):
    sample_rate = 16_000
    audio = np.zeros(sample_rate * 20, dtype=np.float32)
    audio[sample_rate * 1:sample_rate * 19] = 0.1
    monkeypatch.setattr(text_engine, "load_mono", lambda _audio, _sample_rate: (audio, sample_rate))
    aligner = Qwen3ForcedAligner("unused")

    # First lines intentionally consume absurd amounts of time, reproducing the
    # v8 production failure where only a small prefix (18/186 words) survived.
    calls = {"n": 0}
    def bad_align(_path, phrase, _language):
        calls["n"] += 1
        tokens = phrase.split()
        if calls["n"] <= 2:
            return [Word(i * 2.0, i * 2.0 + 1.5, token, 0.8, i) for i, token in enumerate(tokens)]
        return []

    monkeypatch.setattr(aligner, "align", bad_align)
    text = "\n".join([f"line {i} alpha beta gamma delta" for i in range(31)])
    expected = text_engine.tokenize(text)
    words = aligner.align_long_text("song.wav", text, "English")

    assert len(words) == len(expected)
    assert [w.text for w in words] == expected
    assert all(b.start >= a.end - 1e-6 for a, b in zip(words, words[1:]))
    assert words[-1].end <= 20.0


def test_long_text_prefers_acoustic_ctc_lines_before_qwen(monkeypatch, tmp_path):
    import numpy as np
    import soundfile as sf
    from AI.engines.ctc_alignment import CTCLineResult

    audio = tmp_path / "vocals.wav"
    sf.write(audio, np.zeros(16000 * 8, dtype=np.float32), 16000)
    aligner = Qwen3ForcedAligner("unused")
    text = "Первая строка\nВторая строка"

    class FakeCTC:
        def available_for(self, language, text):
            return True

        def align_lines(self, audio, groups, language, anchors):
            return [
                CTCLineResult((
                    Word(1.0, 1.5, "Первая", 0.8, 0),
                    Word(1.5, 2.0, "строка", 0.8, 1),
                ), 0.8, 0.0, 4.0),
                CTCLineResult((
                    Word(3.0, 3.5, "Вторая", 0.85, 0),
                    Word(3.5, 4.0, "строка", 0.85, 1),
                ), 0.85, 2.0, 6.0),
            ]

        def release(self):
            pass

    aligner._ctc = FakeCTC()

    def qwen_must_not_run(*args, **kwargs):
        raise AssertionError("Qwen fallback should not run for accepted CTC lines")

    monkeypatch.setattr(aligner, "align", qwen_must_not_run)
    words = aligner.align_long_text(audio, text, "Russian")
    assert [word.text for word in words] == ["Первая", "строка", "Вторая", "строка"]
    assert [word.start for word in words] == [1.0, 1.5, 3.0, 3.5]
    assert aligner.last_alignment_diagnostics["ctc_lines"] == 2
    assert aligner.last_alignment_diagnostics["qwen_fallback_lines"] == 0


def test_long_text_required_ctc_reports_checked_paths(monkeypatch):
    import numpy as np
    monkeypatch.setenv("KARAOKE_AI_REQUIRE_CTC", "1")
    monkeypatch.setattr(text_engine, "load_mono", lambda _audio, _sample_rate: (np.zeros(16000 * 5), 16000))
    aligner = Qwen3ForcedAligner("unused")

    class MissingCTC:
        last_resource_diagnostics = {
            "ru": {
                "available": False,
                "reason": "config.json is missing",
                "checked": [{"path": "C:/models/ctc/ru", "reason": "config.json is missing"}],
            }
        }
        def available_for(self, language, text): return False
        def release(self): pass

    aligner._ctc = MissingCTC()
    import pytest
    with pytest.raises(text_engine.EngineUnavailableError) as error:
        aligner.align_long_text("song.wav", "Первая строка\nВторая строка", "Russian")
    message = str(error.value)
    assert "config.json is missing" in message
    assert "C:/models/ctc/ru" in message

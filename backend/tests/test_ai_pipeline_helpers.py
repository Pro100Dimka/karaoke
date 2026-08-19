
from tests._shared import patch_attrs, raises

from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from AI import pipeline
from AI.errors import EngineUnavailableError, InvalidArtifactError, ProcessingCancelledError
from AI.models import PitchFrame, Syllable, VocalNote, Word
from AI.quality import QualityReport
from AI.vocal_preprocess import PitchTrackQuality


def words(*items): return [Word(start, end, text, confidence, index) for index, (start, end, text, confidence) in enumerate(items)]


def test_bound_and_trim_canonical_words(): source = words((0, 10, "x", 0.8), (10, 20, "verylongtoken", 0.8)); bounded = pipeline._bound_word_durations(source); assert (bounded[0].end == 0.7 and bounded[1].end <= 13.2) and (pipeline._trim_supplied_text_to_aligned_words('a\nb c\nd', []) == '') and (pipeline._trim_supplied_text_to_aligned_words(' plain ', [source[0]]) == 'plain'); aligned = words((0, 1, "a", 1), (1, 2, "b", 1), (2, 3, "c", 1)); assert (pipeline._trim_supplied_text_to_aligned_words('a\nb c\nd', aligned) == 'a\nb c') and (pipeline._trim_supplied_text_to_aligned_words('a\nb c', aligned[:2]) == 'a') and (pipeline._trim_supplied_text_to_aligned_words('!!!\na', aligned[:1]) == 'a') and (pipeline._trim_supplied_text_to_aligned_words(' \n ', aligned) == '')


def _pitch_frames(*, voiced_times, silent_times=()):
    frames = [
        PitchFrame(time=t, frequency=220.0, confidence=0.8, voiced=True) for t in voiced_times
    ]
    frames += [
        PitchFrame(time=t, frequency=0.0, confidence=0.0, voiced=False) for t in silent_times
    ]
    return frames


def test_segments_ignore_real_singing_detects_a_structural_mismatch(): segments, mismatched_pitch = ((0.0, 2.0, 'line one'), (20.0, 22.0, 'line two')), _pitch_frames(voiced_times=[0.5, 1.5, 8.0, 9.0, 10.0, 11.0, 21.0]); assert pipeline._segments_ignore_real_singing(segments, mismatched_pitch); matching_pitch = _pitch_frames(voiced_times=[0.5, 1.5, 20.5, 21.5], silent_times=[10.0, 11.0]); assert (not pipeline._segments_ignore_real_singing(segments, matching_pitch)) and (not pipeline._segments_ignore_real_singing((), mismatched_pitch)) and (not pipeline._segments_ignore_real_singing(segments, []))


def test_canonical_identity_and_publishability():
    aligned = words((0, 1, "Hello", 1), (1, 2, "world", 1)); assert (pipeline._canonical_alignment_matches('hello, world!', aligned)) and (not pipeline._canonical_alignment_matches('hello', aligned)) and (not pipeline._canonical_alignment_matches('other world', aligned)) and (not pipeline._canonical_timeline_is_publishable([], 2)) and (pipeline._canonical_timeline_is_publishable(aligned, 2))
    invalid = [
        [SimpleNamespace(start=float("nan"), end=1)],
        [SimpleNamespace(start=-1, end=1)],
        [SimpleNamespace(start=0, end=0.001)],
        [SimpleNamespace(start=0, end=3)],
        [SimpleNamespace(start=1, end=2), SimpleNamespace(start=0.5, end=1)],
    ]
    for values in invalid:
        assert not pipeline._canonical_timeline_is_publishable(values, 2)


def test_local_timeline_repair_success_and_rejections(): assert pipeline._repair_canonical_timeline_locally([], 1) is None; overlap = words((0, 1, "a", 1), (0.9, 1.5, "b", 1)); repaired = pipeline._repair_canonical_timeline_locally(overlap, 3); assert (repaired and repaired[1].start == repaired[0].end and (repaired[1].confidence == 0.25)) and (pipeline._repair_canonical_timeline_locally(overlap, 1.2) is None); huge = words((0, 2, "a", 1), (0, 1, "b", 1)); assert pipeline._repair_canonical_timeline_locally(huge, 10) is None


def test_preserve_complete_timeline_repairs_bounds_and_suffix(): assert pipeline._preserve_complete_canonical_timeline([], 1) is None; overlap = words((0, 1, "a", 1), (0.8, 2, "b", 0), (1.99, 3.5, "c", 0.5)); repaired = pipeline._preserve_complete_canonical_timeline(overlap, 3); assert (repaired and repaired[0].start == 0 and (repaired[-1].end == 3)) and (all((0 <= word.confidence <= 1 for word in repaired))); impossible = words((0, 1, "a", 1), (0, 1, "b", 1), (0, 1, "c", 1)); assert pipeline._preserve_complete_canonical_timeline(impossible, 0.02) is None; shifted = words((0, 1, "a", 1), (0, 1.02, "b", 1)); assert pipeline._preserve_complete_canonical_timeline(shifted, 2)[1].start == 0.5; clipped = words((0, 1, "a", 1), (1.1, 3, "b", 1)); assert pipeline._preserve_complete_canonical_timeline(clipped, 2)[1].end == 2; eof = words((1.995, 3, "a", 1)); assert pipeline._preserve_complete_canonical_timeline(eof, 2)[0].start == 1.99


def test_lossless_canonical_words_preserve_or_retime(): aligned = words((0, 1, "a", 0.8), (1, 2, "b", 0.9)); assert (pipeline._pipeline_lossless_canonical_words('', aligned, 2) is aligned) and (pipeline._pipeline_lossless_canonical_words('a b', aligned, 2)[0].confidence == 0.8); retimed = pipeline._pipeline_lossless_canonical_words("long x", aligned[:1], 0.1); assert ([word.text for word in retimed] == ['long', 'x']) and (all((word.confidence == 0.004 for word in retimed))); raises(InvalidArtifactError, lambda: pipeline._pipeline_lossless_canonical_words('a b', aligned, 0.5), match='could not be locally')


def test_retiming_split_weights_vowels_not_just_character_count():
    mismatched = words((0, 1, "other", 1)); retimed = pipeline._pipeline_lossless_canonical_words("я тьмы", mismatched[:1], 9.0); assert ([word.text for word in retimed] == ['я', 'тьмы']) and (retimed[0].start == pytest.approx(0.0)) and (retimed[0].end == pytest.approx(3.0)) and (retimed[1].start == pytest.approx(3.0)) and (retimed[1].end == pytest.approx(9.0)); reset = pipeline._pipeline_lossless_canonical_words("a b", words((0.09, 0.1, "x", 1)), 0.1)
    assert reset[0].start == 0
    tiny = pipeline._pipeline_lossless_canonical_words(
        "verylongtoken x", words((0, 0.1, "mismatch", 1)), 0.1
    )
    assert tiny[-1].end == 0.1


def test_lossless_words_repair_only_collapsed_transient_span():
    original = words(
        (55.757884630828, 56.240116035786684, "сердце", 0.3333),
        (56.240116035786684, 56.26011603578669, "покой", 0.012),
        (56.24511603578669, 56.26511603578669, "Я", 0.012),
        (56.2651160357867, 56.2851160357867, "в", 0.012),
        (56.28011603578668, 56.43011603578668, "Черты", 0.3),
        (75.76090877868262, 75.82115117411988, "Но", 0.003),
    )
    repaired = pipeline._pipeline_lossless_canonical_words(
        "сердце покой Я в Черты Но",
        original,
        195.54913832199546,
        ["ctc", "interpolated", "interpolated", "reacquired", "reacquired", "qwen"],
    )
    assert (repaired[0] == original[0] and repaired[5] == original[5]) and ([(word.text, word.confidence) for word in repaired] == [(word.text, word.confidence) for word in original]) and (all((left.end <= right.start for left, right in zip(repaired, repaired[1:], strict=False)))) and (repaired[1].start == original[0].end) and (repaired[4].end == pytest.approx(original[5].start))


def _candidate(start, end, confidence=0.5, kind='ctc'): return {kind: {'start': start, 'end': end, 'confidence': confidence}}


def test_confidence_aware_repair_preserves_candidate_before_weak_anchor():
    original, sources = words((4.630521255, 4.790885628, 'после', 0.2000004), (4.790885628, 4.83475, 'любви', 0.012), (4.83475, 4.854835776, 'Я', 4.1e-06), (4.874921552, 5.055693534, 'хочу', 6.27e-05), (5.115950862, 6.92367069, 'наслаждаться', 0.3046425)), ['ctc', 'interpolated', 'ctc', 'ctc', 'ctc']
    repaired = pipeline._pipeline_lossless_canonical_words(
        "после любви Я хочу наслаждаться",
        original,
        195.549138322,
        sources,
        [
            _candidate(4.630521255, 4.790885628, 0.2000004),
            _candidate(4.830976721, 4.951250000, 0.0000661),
            _candidate(4.834750000, 4.854835776, 0.0000041),
            _candidate(4.874921552, 5.055693534, 0.0000627),
            _candidate(5.115950862, 6.923670690, 0.3046425),
        ],
    )
    assert ((repaired[1].start, repaired[1].end) == (4.830976721, 4.95125)) and (repaired[0] == original[0] and repaired[4] == original[4]) and (sources[1] == 'reacquired' and sources[2] == 'interpolated')


def test_weak_anchor_cannot_pull_following_sequence():
    original = words(
        (0.2, 0.8, "left", 0.9),
        (0.8, 0.82, "weak", 0.000001),
        (1.10, 1.35, "one", 0.012),
        (1.40, 1.70, "two", 0.012),
        (2.0, 2.5, "right", 0.95),
    )
    repaired = pipeline._pipeline_lossless_canonical_words(
        "left weak one two right",
        original,
        3.0,
        ["ctc", "ctc", "interpolated", "interpolated", "qwen"],
        [
            _candidate(0.2, 0.8, 0.9),
            _candidate(0.81, 0.83, 0.000001),
            _candidate(1.10, 1.35, 0.4),
            _candidate(1.40, 1.70, 0.4),
            _candidate(2.0, 2.5, 0.95, "qwen"),
        ],
    )
    assert ((repaired[2].start, repaired[2].end), (repaired[3].start, repaired[3].end), repaired[4]) == ((1.1, 1.35), (1.4, 1.7), original[4])


def test_unreliable_span_is_local_and_reliable_anchors_are_exact():
    original = words(
        (1.0, 1.4, "a", 0.95),
        (1.4, 1.42, "b", 0.000001),
        (1.42, 1.44, "c", 0.012),
        (2.4, 2.9, "d", 0.9),
    )
    repaired = pipeline._pipeline_lossless_canonical_words(
        "a b c d",
        original,
        4.0,
        ["ctc", "ctc", "interpolated", "qwen"],
        [
            _candidate(1.0, 1.4, 0.95),
            _candidate(1.41, 1.43, 0.000001),
            {},
            _candidate(2.4, 2.9, 0.9, "qwen"),
        ],
    )
    assert ((repaired[0], repaired[3]) == (original[0], original[3])) and (all((left.end <= right.start for left, right in zip(repaired, repaired[1:], strict=False))))


def test_local_interpolation_gap_also_weights_vowels_not_just_length():
    original = words(
        (0.0, 1.0, "anchor", 0.95),
        (1.0, 1.005, "я", 0.000001),
        (1.005, 1.008, "тьмы", 0.000001),
        (10.0, 10.5, "right", 0.9),
    )
    repaired = pipeline._pipeline_lossless_canonical_words(
        "anchor я тьмы right",
        original,
        11.0,
        ["ctc", "interpolated", "interpolated", "qwen"],
        [
            _candidate(0.0, 1.0, 0.95),
            {},
            {},
            _candidate(10.0, 10.5, 0.9, "qwen"),
        ],
    )
    assert (repaired[1].start == pytest.approx(1.0)) and (repaired[1].end == pytest.approx(4.0)) and (repaired[2].start == pytest.approx(4.0)) and (repaired[2].end == pytest.approx(10.0))


def test_existing_acoustic_candidate_precedes_synthetic_interpolation():
    original = words(
        (0.0, 0.5, "left", 0.9),
        (0.5, 0.7, "candidate", 0.012),
        (1.5, 2.0, "right", 0.9),
    )
    repaired = pipeline._pipeline_lossless_canonical_words(
        "left candidate right",
        original,
        2.5,
        ["ctc", "interpolated", "ctc"],
        [_candidate(0.0, 0.5, 0.9), _candidate(0.72, 1.12, 0.02), _candidate(1.5, 2.0, 0.9)],
    )
    assert (repaired[1].start, repaired[1].end) == (0.72, 1.12)


def test_former_invalid_artifact_conflict_repairs_only_local_span():
    original = words(
        (10.0, 10.5, "anchor", 0.9),
        (10.5, 10.52, "bad", 0.000001),
        (10.51, 10.53, "local", 0.012),
        (20.0, 20.5, "fixed", 0.95),
        (25.0, 25.5, "later", 0.9),
    )
    repaired = pipeline._pipeline_lossless_canonical_words(
        "anchor bad local fixed later",
        original,
        30.0,
        ["ctc", "ctc", "interpolated", "qwen", "ctc"],
        [
            _candidate(10.0, 10.5, 0.9),
            _candidate(10.51, 10.53, 0.000001),
            {},
            _candidate(20.0, 20.5, 0.95, "qwen"),
            _candidate(25.0, 25.5, 0.9),
        ],
    )
    assert ((repaired[0], repaired[3:]) == (original[0], original[3:])) and (pipeline._canonical_timeline_is_publishable(repaired, 30.0))


class Console(StringIO):
    encoding = "cp1251"

    def __init__(self): super().__init__(); self.reconfigured = False

    def reconfigure(self, **_): self.reconfigured = True


def test_lyrics_console_language_and_summary(monkeypatch):
    stream = Console()
    with monkeypatch.context() as context:
        context.setattr(pipeline.sys, "__stdout__", stream); pipeline._lyrics_console("привет", 2)
    assert stream.reconfigured and "привет 2" in stream.getvalue(); broken = Mock(); broken.write.side_effect = OSError("closed")
    with monkeypatch.context() as context:
        context.setattr(pipeline.sys, "__stdout__", broken); pipeline._lyrics_console("ignored")
    assert (pipeline._lyrics_language_hint('Українська їжа є') == 'uk') and (pipeline._lyrics_language_hint('Русская песня ё') == 'ru') and (pipeline._lyrics_language_hint('English') is None); calls = []; monkeypatch.delenv("KARAOKE_LYRICS_LOG_TEXT", raising=False); monkeypatch.setattr(pipeline, "_lyrics_console", lambda *parts: calls.append(parts))
    pipeline._print_full_lyrics("source", "a\n\nb", None); assert (len(calls) == 1) and ('source=source' in calls[0][0] and 'lines=2' in calls[0][0])

    calls.clear(); monkeypatch.setenv("KARAOKE_LYRICS_LOG_TEXT", "1"); pipeline._print_full_lyrics("source", "a\n\nb", "query")
    assert calls == [
        ("[lyrics] result: source=source query='query' lines=2 chars=4",),
        ("[lyrics] FOUND TEXT BEGIN",),
        ("a\n\nb",),
        ("[lyrics] FOUND TEXT END",),
    ]


def config(**changes):
    values = {
        "validate_cached_artifacts": True,
        "allow_fallback": False,
        "pitch_sample_rate": 100,
        "hop_seconds": 0.01,
        "fmin_hz": 50,
        "fmax_hz": 500,
    }
    values.update(changes); return SimpleNamespace(**values)


def make_pipeline(**changes): instance = object.__new__(pipeline.KaraokePipeline); instance.config = config(**changes); instance.engines = SimpleNamespace(); return instance


def test_pipeline_init_remove_cache_and_notify(monkeypatch, tmp_path): cfg, engines = config(), object(); assert pipeline.KaraokePipeline(cfg, engines).engines is engines; stale = tmp_path / "stale"; stale.touch(); pipeline.KaraokePipeline._remove_stale(stale, tmp_path / "missing"); assert not stale.exists(); cache = Mock(); cache.hit.return_value = True; instance = make_pipeline(validate_cached_artifacts=False); assert (instance._cache_hit(cache, 's', 'k', [], {tmp_path: Mock()})) and (cache.hit.call_args.kwargs['validators'] is None); request = pipeline.PipelineRequest("in", "out", progress=Mock()); instance._notify(request, "stage", 120, "message"); request.progress.assert_called_once_with("stage", 100, "message"); raises(ProcessingCancelledError, lambda: instance._notify(pipeline.PipelineRequest('i', 'o', cancelled=lambda: True), 's', 0, 'm'))


def test_pipeline_run_stage_primary_fallback_and_disabled(monkeypatch):
    reports, warnings = [], []; instance, engine = make_pipeline(), SimpleNamespace(name='primary'); assert (instance._run('pitch', engine, lambda _: 'ok', reports, warnings) == 'ok') and (reports[-1].engine == 'primary')

    instance, fallback = make_pipeline(allow_fallback=True), SimpleNamespace(name='fallback'); monkeypatch.setattr(pipeline, "PyinFallbackPitchEstimator", lambda *_: fallback); calls = 0

    def operation(selected):
        nonlocal calls; calls += 1
        if calls == 1: raise EngineUnavailableError("missing")
        return selected.name

    assert (instance._run('pitch', engine, operation, (reports := []), (warnings := [])) == 'fallback') and (warnings == ['missing'] and reports[0].engine == 'fallback'); instance = make_pipeline(allow_fallback=False); raises(EngineUnavailableError, lambda: instance._run('pitch', engine, lambda _: (_ for _ in ()).throw(EngineUnavailableError('x')), [], []))


def test_publish_alignment_midi_and_run_lock(monkeypatch, tmp_path):
    publish = Mock(); patch_attrs(monkeypatch, pipeline, publish_files_atomically=publish, validate_json=Mock()); aligned = words((0, 1, "a", 1))
    pipeline.KaraokePipeline._publish_text_alignment(
        tmp_path, tmp_path / "lyrics.txt", tmp_path / "sync.json", "a", aligned
    )
    assert publish.call_count == 1; patch_attrs(monkeypatch, pipeline, write_midi=Mock(), validate_midi=Mock())
    pipeline.KaraokePipeline._publish_midi_pair(
        tmp_path, tmp_path / "v.mid", tmp_path / "g.mid", [1], [], aligned, [], 120, 2
    )
    assert publish.call_count == 2; instance = make_pipeline(); monkeypatch.setattr(instance, "_run_unlocked", lambda request: "done"); assert (instance.run(pipeline.PipelineRequest('in', tmp_path)) == 'done') and (pipeline._OutputDirectoryLock(tmp_path).path == tmp_path / '.pipeline.lock')


def test_pipeline_rejects_missing_and_generated_sources(tmp_path): instance = make_pipeline(); raises(FileNotFoundError, lambda: instance._run_unlocked(pipeline.PipelineRequest(tmp_path / 'missing.mp3', tmp_path))); generated = tmp_path / "song.wav"; generated.write_bytes(b"audio"); raises(ValueError, lambda: instance._run_unlocked(pipeline.PipelineRequest(generated, tmp_path)), match='pipeline-generated')


@pytest.mark.parametrize(
    "mode",
    [
        "trusted",
        "asr",
        "cached-trusted",
        "cached-asr",
        "long",
        "anchor-fail",
        "segments",
        "cached-segments",
        "variants",
        "explicit",
        "invalid-bpm",
        "source-change",
        "missing-artifact",
        "omnizart",
        "omnizart-fail",
    ],
)
def test_full_pipeline_fresh_supplied_lyrics_flow(monkeypatch, tmp_path, mode):
    trusted_lyrics, cached, lyric_text = mode not in {'asr', 'cached-asr'}, mode.startswith('cached'), ' '.join((f'word{i}' for i in range(60))) if mode in {'long', 'anchor-fail'} else 'hello world'; supplied_segments, source = ((0.0, 2.0, lyric_text),) if mode in {'segments', 'cached-segments'} else (), tmp_path / 'source.mp3'; source.write_bytes(b"source"); output, hash_count = tmp_path / 'output', 0

    def source_hash(): nonlocal hash_count; hash_count += 1; return f"hash:{source.name}:{hash_count}"

    class Cache:
        def __init__(self, root): self.root = root

        @staticmethod
        def key(stage, payload): return f"{stage}:{len(str(payload))}"

        @staticmethod
        def file_hash(path): return source_hash() if mode == 'source-change' and Path(path) == source else f'hash:{Path(path).name}'

        @staticmethod
        def optional_file_hash(path): return None if path is None else f"optional:{Path(path).name}"

        def hit(self, stage, _key, outputs, validators=None):
            del validators
            if not cached: return False
            for path in outputs:
                path.parent.mkdir(parents=True, exist_ok=True)
                if stage == "tempo":
                    pipeline.write_json_atomic(path, {"bpm": 120, "key": "C"})
                elif stage == "pitch":
                    pipeline.write_json_atomic(
                        path,
                        [
                            {
                                "time": 0,
                                "frequency": 220,
                                "confidence": 0.8,
                                "voiced": True,
                                "energy": 0.1,
                            }
                        ],
                    )
                elif stage in {"alignment", "transcription"}:
                    if path.name == "lyrics.txt":
                        path.write_text(lyric_text + "\n", encoding="utf-8")
                    else:
                        pipeline.write_json_atomic(
                            path,
                            {
                                "text": lyric_text,
                                "words": [
                                    {
                                        "start": 0,
                                        "end": 1,
                                        "text": "hello",
                                        "confidence": 0.8,
                                        "index": 0,
                                    },
                                    {
                                        "start": 1,
                                        "end": 2,
                                        "text": "world",
                                        "confidence": 0.8,
                                        "index": 1,
                                    },
                                ],
                            },
                        )
                elif stage == "derivation":
                    payloads = {
                        "syllables.json": {
                            "syllables": [
                                {"start": 0, "end": 1, "text": "hello", "word_index": 0, "index": 0}
                            ]
                        },
                        "reference.json": {
                            "notes": [
                                {
                                    "start": 0,
                                    "end": 1,
                                    "midi_note": 60,
                                    "word_index": 0,
                                    "syllable_index": 0,
                                }
                            ]
                        },
                        "acousticNotes.json": {
                            "notes": [
                                {
                                    "start": 0,
                                    "end": 1,
                                    "midi_note": 60,
                                    "word_index": 0,
                                    "syllable_index": 0,
                                }
                            ]
                        },
                        "melodyContour.json": {"frames": []},
                    }
                    pipeline.write_json_atomic(path, payloads[path.name])
                elif stage == "song-map":
                    pipeline.write_json_atomic(path, {"duration": 5})
                else:
                    path.write_bytes(stage.encode())
            return True

        @staticmethod
        def commit(*_args, **_kwargs): return None

        @staticmethod
        def invalidate(*_args, **_kwargs): return None

    patch_attrs(monkeypatch, pipeline, StageCache=Cache, decode_audio=lambda _source, target, _rate: target.write_bytes(b'wav') or target, duration=lambda _: 5.0)
    for name in (
        "validate_audio",
        "validate_pitch",
        "validate_timeline",
        "validate_within_duration",
        "validate_json",
        "validate_midi",
        "validate_music_json",
        "validate_pitch_json",
        "validate_words_json",
        "validate_derivation_json",
    ):
        monkeypatch.setattr(pipeline, name, lambda *_args, **_kwargs: None)
    patch_attrs(monkeypatch, pipeline, discover_lyrics=lambda *_args, **_kwargs: SimpleNamespace(text=lyric_text if trusted_lyrics else '', segments=supplied_segments, source='trusted', query='query')); separator, raw_pitch = SimpleNamespace(name='separator', config=None, checkpoint=None, engine_dir=None, separate=lambda _mix, vocals, instrumental: (vocals.write_bytes(b'vocals'), instrumental.write_bytes(b'instrumental'))), [PitchFrame(0, 220, 0.8, True, 0.1), PitchFrame(0.01, 220, 0.8, True, 0.1), PitchFrame(0.02, 220, 0.8, True, 0.1)]; pitch_engine, aligner, transcriber, melody = SimpleNamespace(name='pitch', fingerprint=lambda: {'model': 'x'}, estimate=lambda _: raw_pitch), SimpleNamespace(name='aligner', model_name='aligner-model', last_alignment_diagnostics={'word_sources': ['ctc', 'qwen'], 'word_candidates': [{}, {}], 'score': 1}, align=lambda *_: words((0, 1, 'hello', 0.8), (1, 2, 'world', 0.8)), align_segments=lambda *_: words((0, 1, 'hello', 0.8), (1, 2, 'world', 0.8)), align_long_text=lambda *_: [Word(index * 0.05, (index + 1) * 0.05, token, 0.8, index) for index, token in enumerate(lyric_text.split())], set_global_asr_segments=Mock()), SimpleNamespace(name='transcriber', model_name='transcriber-model', last_language='en', last_segments=[(0, 2, 'hello world')], set_pitch_activity=Mock(), transcribe=(lambda *_: (_ for _ in ()).throw(RuntimeError('anchor unavailable'))) if mode == 'anchor-fail' else lambda *_: ('hello world', []), release=Mock()), None
    if mode == "omnizart":
        melody = SimpleNamespace(
            name="omnizart-patch-cnn",
            fingerprint=lambda: {"version": "test"},
            estimate=lambda path: raw_pitch if Path(path).name == "song.wav" else [],
        )
    elif mode == "omnizart-fail":
        melody = SimpleNamespace(
            name="omnizart-patch-cnn",
            fingerprint=lambda: {"version": "test"},
            estimate=lambda _path: (_ for _ in ()).throw(EngineUnavailableError("broken")),
        )
    engines, cfg = SimpleNamespace(separator=separator, pitch=pitch_engine, aligner=aligner, transcriber=transcriber, melody=melody), SimpleNamespace(sample_rate=44100, pitch_sample_rate=16000, hop_seconds=0.01, fmin_hz=55, fmax_hz=1400, preserve_raw_pitch=mode != 'variants', validate_cached_artifacts=True, allow_fallback=False, min_note_sec=0.05, min_voiced_confidence=0.3, split_note_semitones=0.8, max_gap_sec=0.05, midi_bend_range=2, write_quality_report=mode != 'variants'); patch_attrs(monkeypatch, pipeline, analyze_music=lambda _: {'bpm': 120, 'key': 'C', 'tempo_source': 'analysis'})

    def cleanup(_source, denoise, tail): denoise.write_bytes(b"denoise"); tail.write_bytes(b"tail"); return {"denoise": denoise, "tail-suppressed": tail}

    patch_attrs(monkeypatch, pipeline, prepare_midi_analysis_variants=cleanup, score_pitch_track=lambda _: PitchTrackQuality(0.8, 1, 0.8, 0, 0, 0), choose_best_pitch_track=lambda _: 'tail-suppressed', refine_pitch_confidence=lambda frames, *_args, **_kwargs: frames, fuse_pitch_with_yin=lambda frames, *_args, **_kwargs: frames); stabilizer = Mock(side_effect=lambda frames: frames); monkeypatch.setattr(pipeline, "stabilize_pitch", stabilizer); syllables, vocal_notes = [Syllable(0, 1, 'hello', 0, 0), Syllable(1, 2, 'world', 1, 1)], [VocalNote(0, 1, 60, word_index=0, syllable_index=0)]
    patch_attrs(monkeypatch, pipeline, align_syllables=lambda *_: syllables, build_vocal_notes=lambda *_args, **_kwargs: [] if mode == 'variants' else vocal_notes, get_note_diagnostics=lambda: {'ok': True}, build_game_notes=lambda notes, *_args, **_kwargs: notes)

    def midi_file(path, *_args, **_kwargs): Path(path).write_bytes(b"midi"); return Path(path)

    patch_attrs(monkeypatch, pipeline, write_midi=midi_file, build_karaoke_song_map=lambda **_: {'duration': 5}, evaluate_quality=lambda *_: QualityReport(1, 1, 1, 1, 1, 1, 1, ('quality warning',)), analyze_vocal_residuals=Mock(side_effect=ValueError('diagnostic failed')) if mode == 'variants' else lambda *_: {'available': True}, build_alignment_debug=lambda **_: {'health': {}, 'summary': {}, 'suspicious_regions': [], 'timeline_integrity': {}, 'root_cause_analysis': {}, 'pitch_source_analysis': {}, 'vocal_effect_analysis': {}, 'performance': {}})

    def environment_info():
        if mode == "missing-artifact": (output / "song.wav").unlink()
        return {"device": "test"}

    monkeypatch.setattr(pipeline, "environment_info", environment_info); progress, lyrics_path = Mock(), None
    if mode == "explicit":
        lyrics_path = tmp_path / "explicit.txt"; lyrics_path.write_text(lyric_text, encoding="utf-8")
    request = pipeline.PipelineRequest(
        source,
        output,
        title="Українська пісня" if mode == "asr" else "Song",
        progress=progress,
        lyrics_path=lyrics_path,
        bpm_override=10 if mode == "invalid-bpm" else 140 if mode == "variants" else None,
        key_override="Am" if mode == "variants" else None,
    )
    if mode in {"invalid-bpm", "source-change", "missing-artifact"}:
        error = {
            "invalid-bpm": ValueError,
            "source-change": RuntimeError,
            "missing-artifact": FileNotFoundError,
        }[mode]
        raises(error, lambda: pipeline.KaraokePipeline(cfg, engines).run(request)); return
    result = pipeline.KaraokePipeline(cfg, engines).run(request); assert (result.manifest_path.exists()) and ('quality warning' in result.warnings) and ((output / 'songMap.json').exists()) and ((output / 'diagnostics.json').exists()); performance = pipeline.read_json(output / "performance.json"); assert (performance['elapsed_sec'] >= 0 and performance['stages']) and (pipeline.read_json(result.manifest_path)['outputs']['performance'] == 'performance.json') and (progress.call_args.args[:2] == ('complete', 100))
    if mode == "omnizart":
        assert any(report.stage == "pitch-primary" for report in result.reports); assert not any(report.stage == "pitch-original" for report in result.reports); stabilizer.assert_not_called()
    elif mode == "omnizart-fail":
        assert any("FCPE/YIN fallback" in warning for warning in result.warnings); assert (output / "separated" / "vocals.midi-analysis.wav").exists()

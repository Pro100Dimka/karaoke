
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from AI import pipeline
from AI.errors import EngineUnavailableError, ProcessingCancelledError
from AI.models import PitchFrame, Syllable, VocalNote, Word
from tests._shared import patch_attrs, raises, word_rows


def test_publish_text_alignment_preserves_engine_timestamps_exactly(tmp_path):
    words = word_rows(
        (64.770123456789, 65.031987654321, "Пять", 0.123456789),
        (65.111222333444, 65.973999888777, "киловатт", 0.987654321),
    )
    lyrics_txt, words_path = tmp_path / "lyrics.txt", tmp_path / "lyricsSync.json"
    pipeline.KaraokePipeline._publish_text_alignment(
        tmp_path, lyrics_txt, words_path, "Пять киловатт", words
    )
    saved = pipeline.read_json(words_path)["words"]
    assert saved == [pipeline.to_dict(word) for word in words]


class Console(StringIO):
    encoding = "cp1251"

    def __init__(self):
        super().__init__()
        self.reconfigured = False

    def reconfigure(self, **_):
        self.reconfigured = True


def test_lyrics_console_language_and_summary(monkeypatch):
    stream = Console()
    with monkeypatch.context() as context:
        context.setattr(pipeline.sys, "__stdout__", stream)
        pipeline._lyrics_console("привет", 2)
    assert stream.reconfigured and "привет 2" in stream.getvalue()
    broken = Mock()
    broken.write.side_effect = OSError("closed")
    with monkeypatch.context() as context:
        context.setattr(pipeline.sys, "__stdout__", broken)
        pipeline._lyrics_console("ignored")
    assert (pipeline._lyrics_language_hint('Українська їжа є') == 'uk') and (pipeline._lyrics_language_hint('Русская песня ё') == 'ru') and (pipeline._lyrics_language_hint('English') is None)
    calls = []
    monkeypatch.delenv("KARAOKE_LYRICS_LOG_TEXT", raising=False)
    monkeypatch.setattr(pipeline, "_lyrics_console", lambda *parts: calls.append(parts))
    pipeline._print_full_lyrics("source", "a\n\nb", None)
    assert (len(calls) == 1) and ('source=source' in calls[0][0] and 'lines=2' in calls[0][0])

    calls.clear()
    monkeypatch.setenv("KARAOKE_LYRICS_LOG_TEXT", "1")
    pipeline._print_full_lyrics("source", "a\n\nb", "query")
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
    values.update(changes)
    return SimpleNamespace(**values)


def make_pipeline(**changes):
    instance = object.__new__(pipeline.KaraokePipeline)
    instance.config = config(**changes)
    instance.engines = SimpleNamespace()
    return instance


def test_pipeline_init_remove_cache_and_notify(monkeypatch, tmp_path):
    cfg, engines = config(), object()
    assert pipeline.KaraokePipeline(cfg, engines).engines is engines
    stale = tmp_path / "stale"
    stale.touch()
    pipeline.KaraokePipeline._remove_stale(stale, tmp_path / "missing")
    assert not stale.exists()
    cache = Mock()
    cache.hit.return_value = True
    instance = make_pipeline(validate_cached_artifacts=False)
    assert (instance._cache_hit(cache, 's', 'k', [], {tmp_path: Mock()})) and (cache.hit.call_args.kwargs['validators'] is None)
    request = pipeline.PipelineRequest("in", "out", progress=Mock())
    instance._notify(request, "stage", 120, "message")
    request.progress.assert_called_once_with("stage", 100, "message")
    raises(ProcessingCancelledError, lambda: instance._notify(pipeline.PipelineRequest('i', 'o', cancelled=lambda: True), 's', 0, 'm'))


def test_pipeline_run_stage_primary_fallback_and_disabled(monkeypatch):
    reports, warnings = [], []
    instance, engine = make_pipeline(), SimpleNamespace(name='primary')
    assert (instance._run('pitch', engine, lambda _: 'ok', reports, warnings) == 'ok') and (reports[-1].engine == 'primary')

    instance, fallback = make_pipeline(allow_fallback=True), SimpleNamespace(name='fallback')
    monkeypatch.setattr(pipeline, "PyinFallbackPitchEstimator", lambda *_: fallback)
    calls = 0

    def operation(selected):
        nonlocal calls
        calls += 1
        if calls == 1: raise EngineUnavailableError("missing")
        return selected.name

    assert (instance._run('pitch', engine, operation, (reports := []), (warnings := [])) == 'fallback') and (warnings == ['missing'] and reports[0].engine == 'fallback')
    instance = make_pipeline(allow_fallback=False)
    raises(EngineUnavailableError, lambda: instance._run('pitch', engine, lambda _: (_ for _ in ()).throw(EngineUnavailableError('x')), [], []))


def test_publish_alignment_and_run_lock(monkeypatch, tmp_path):
    publish = Mock()
    patch_attrs(monkeypatch, pipeline, publish_files_atomically=publish, validate_json=Mock())
    aligned = word_rows((0, 1, "a", 1))
    pipeline.KaraokePipeline._publish_text_alignment(
        tmp_path, tmp_path / "lyrics.txt", tmp_path / "sync.json", "a", aligned
    )
    assert publish.call_count == 1
    instance = make_pipeline()
    monkeypatch.setattr(instance, "_run_unlocked", lambda request: "done")
    assert (instance.run(pipeline.PipelineRequest('in', tmp_path)) == 'done') and (pipeline._OutputDirectoryLock(tmp_path).path == tmp_path / '.pipeline.lock')


def test_pipeline_rejects_missing_and_generated_sources(tmp_path):
    instance = make_pipeline()
    raises(FileNotFoundError, lambda: instance._run_unlocked(pipeline.PipelineRequest(tmp_path / 'missing.mp3', tmp_path)))
    generated = tmp_path / "song.wav"
    generated.write_bytes(b"audio")
    raises(ValueError, lambda: instance._run_unlocked(pipeline.PipelineRequest(generated, tmp_path)), match='pipeline-generated')


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
        "explicit",
        "invalid-bpm",
        "source-change",
        "omnizart",
        "omnizart-fail",
    ],
)
def test_full_pipeline_fresh_supplied_lyrics_flow(monkeypatch, tmp_path, mode):
    trusted_lyrics, cached, lyric_text = mode not in {'asr', 'cached-asr'}, mode.startswith('cached'), ' '.join(f'word{i}' for i in range(60)) if mode in {'long', 'anchor-fail'} else 'hello world'
    supplied_segments, source = ((0.0, 2.0, lyric_text),) if mode in {'segments', 'cached-segments'} else (), tmp_path / 'source.mp3'
    source.write_bytes(b"source")
    output, hash_count = tmp_path / 'output', 0

    def source_hash():
        nonlocal hash_count
        hash_count += 1
        return f"hash:{source.name}:{hash_count}"

    class Cache:
        def __init__(self, root):
            self.root = root

        @staticmethod
        def key(stage, payload):
            return f"{stage}:{len(str(payload))}"

        @staticmethod
        def file_hash(path):
            return source_hash() if mode == 'source-change' and Path(path) == source else f'hash:{Path(path).name}'

        @staticmethod
        def optional_file_hash(path):
            return None if path is None else f"optional:{Path(path).name}"

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
                else:
                    path.write_bytes(stage.encode())
            return True

        @staticmethod
        def commit(*_args, **_kwargs):
            return None

        @staticmethod
        def invalidate(*_args, **_kwargs):
            return None

    patch_attrs(monkeypatch, pipeline, StageCache=Cache, decode_audio=lambda _source, target, _rate: target.write_bytes(b'wav') or target, encode_flac=lambda source, target: target.write_bytes(Path(source).read_bytes()) or target, duration=lambda _: 5.0)
    for name in (
        "validate_audio",
        "validate_pitch",
        "validate_timeline",
        "validate_within_duration",
        "validate_json",
        "validate_music_json",
        "validate_pitch_json",
        "validate_words_json",
    ):
        monkeypatch.setattr(pipeline, name, lambda *_args, **_kwargs: None)
    patch_attrs(monkeypatch, pipeline, discover_lyrics=lambda *_args, **_kwargs: SimpleNamespace(text=lyric_text if trusted_lyrics else '', segments=supplied_segments, source='trusted', query='query'))
    separator, raw_pitch = SimpleNamespace(name='separator', config=None, checkpoint=None, engine_dir=None, separate=lambda _mix, vocals, instrumental: (vocals.write_bytes(b'vocals'), instrumental.write_bytes(b'instrumental'))), [PitchFrame(0, 220, 0.8, True, 0.1), PitchFrame(0.01, 220, 0.8, True, 0.1), PitchFrame(0.02, 220, 0.8, True, 0.1)]
    pitch_engine, aligner, transcriber, melody = SimpleNamespace(name='pitch', fingerprint=lambda: {'model': 'x'}, estimate=lambda _: raw_pitch), SimpleNamespace(name='aligner', model_name='aligner-model', last_alignment_diagnostics={'word_sources': ['ctc', 'qwen'], 'word_candidates': [{}, {}], 'score': 1}, align=lambda *_: word_rows((0, 1, 'hello', 0.8), (1, 2, 'world', 0.8)), align_segments=lambda *_: word_rows((0, 1, 'hello', 0.8), (1, 2, 'world', 0.8)), align_long_text=lambda *_: [Word(index * 0.05, (index + 1) * 0.05, token, 0.8, index) for index, token in enumerate(lyric_text.split())], set_global_asr_segments=Mock()), SimpleNamespace(name='transcriber', model_name='transcriber-model', last_language='en', last_segments=[(0, 2, 'hello world')], set_pitch_activity=Mock(), transcribe=(lambda *_: (_ for _ in ()).throw(RuntimeError('anchor unavailable'))) if mode == 'anchor-fail' else lambda *_: ('hello world', []), release=Mock()), None
    if mode == "omnizart":
        melody = SimpleNamespace(
            name="omnizart-patch-cnn",
            fingerprint=lambda: {"version": "test"},
            estimate=lambda path: raw_pitch if Path(path).name == "vocals.flac" else [],
        )
    elif mode == "omnizart-fail":
        melody = SimpleNamespace(
            name="omnizart-patch-cnn",
            fingerprint=lambda: {"version": "test"},
            estimate=lambda _path: (_ for _ in ()).throw(EngineUnavailableError("broken")),
        )
    engines, cfg = SimpleNamespace(separator=separator, pitch=pitch_engine, aligner=aligner, transcriber=transcriber, melody=melody), SimpleNamespace(sample_rate=44100, pitch_sample_rate=16000, hop_seconds=0.01, fmin_hz=55, fmax_hz=1400, preserve_raw_pitch=True, validate_cached_artifacts=True, allow_fallback=False, min_note_sec=0.05, min_voiced_confidence=0.3, split_note_semitones=0.8, max_gap_sec=0.05)
    patch_attrs(monkeypatch, pipeline, analyze_music=lambda _: {'bpm': 120, 'key': 'C', 'tempo_source': 'analysis'})

    patch_attrs(monkeypatch, pipeline, refine_pitch_confidence=lambda frames, *_args, **_kwargs: frames, fuse_pitch_with_yin=lambda frames, *_args, **_kwargs: frames)
    stabilizer = Mock(side_effect=lambda frames: frames)
    monkeypatch.setattr(pipeline, "stabilize_pitch", stabilizer)
    syllables, vocal_notes = [Syllable(0, 1, 'hello', 0, 0), Syllable(1, 2, 'world', 1, 1)], [VocalNote(0, 1, 60, word_index=0, syllable_index=0)]
    patch_attrs(monkeypatch, pipeline, align_syllables=lambda *_: syllables, build_vocal_notes=lambda *_args, **_kwargs: vocal_notes)
    progress, lyrics_path = Mock(), None
    if mode == "explicit":
        lyrics_path = tmp_path / "explicit.txt"
        lyrics_path.write_text(lyric_text, encoding="utf-8")
    request = pipeline.PipelineRequest(
        source,
        output,
        title="Українська пісня" if mode == "asr" else "Song",
        progress=progress,
        lyrics_path=lyrics_path,
        bpm_override=10 if mode == "invalid-bpm" else None,
    )
    if mode in {"invalid-bpm", "source-change"}:
        error = {
            "invalid-bpm": ValueError,
            "source-change": RuntimeError,
        }[mode]
        raises(error, lambda: pipeline.KaraokePipeline(cfg, engines).run(request))
        return
    result = pipeline.KaraokePipeline(cfg, engines).run(request)
    assert result.manifest_path == output / "lyricsSync.json"
    assert {path.name for path in output.iterdir()} == {"instrumental.flac", "vocals.flac", "lyricsSync.json"}
    lyrics_sync = pipeline.read_json(result.manifest_path)
    assert lyrics_sync["bpm"] == 120 and lyrics_sync["key"] == "C"
    assert all("notes" in word for word in lyrics_sync["words"])
    assert progress.call_args.args[:2] == ('complete', 100)
    if cached:
        stabilizer.assert_not_called()
    else:
        stabilizer.assert_called_once()

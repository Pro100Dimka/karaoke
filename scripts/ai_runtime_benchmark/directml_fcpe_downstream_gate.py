"""Strict end-to-end downstream gate for the DirectML FCPE candidate.

This tool never changes production backend selection.  It rebuilds the FCPE
fallback pitch path on an already processed song using (a) the authoritative
PyTorch CPU implementation and (b) DirectML, then runs the current downstream
syllable/note/MIDI/songMap/quality code in an isolated temporary directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import statistics
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from AI import runtime  # noqa: E402
from AI.audio import duration, load_mono  # noqa: E402
from AI.config import CoreConfig  # noqa: E402
from AI.engines.fcpe_backends import OrtDirectMLFCPEBackend  # noqa: E402
from AI.engines.pitch import FCPEPitchEstimator  # noqa: E402
from AI.karaoke_timeline import build_karaoke_song_map  # noqa: E402
from AI.midi import write_midi  # noqa: E402
from AI.models import PitchFrame, Syllable, VocalNote, Word, to_dict  # noqa: E402
from AI.notes import NOTE_DECODER_VERSION, build_game_notes, build_vocal_notes  # noqa: E402
from AI.pitch_post import fuse_pitch_with_yin, refine_pitch_confidence, stabilize_pitch  # noqa: E402
from AI.quality import evaluate_quality  # noqa: E402
from AI.syllables import align_syllables  # noqa: E402
from AI.utils.io import read_json, write_json_atomic  # noqa: E402
from AI.vocal_preprocess import choose_best_pitch_track, score_pitch_track  # noqa: E402
from AI.version import AI_BUILD_ID  # noqa: E402

AUDIO_SUFFIXES = {".wav", ".flac"}
FCPE_SOURCES = {"original", "denoise", "tail-suppressed"}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _find_latest_song() -> Path | None:
    roots = []
    for base in (ROOT / "karaoke_songs", ROOT / "backend" / "karaoke_songs"):
        if not base.is_dir():
            continue
        for pitch in base.rglob("pitch.json"):
            root = pitch.parent
            if (root / "lyricsSync.json").is_file() and (root / "music.json").is_file():
                roots.append(root)
    return max(roots, key=lambda p: (p / "pitch.json").stat().st_mtime, default=None)


def _find_audio(song: Path, stem: str) -> Path | None:
    separated = song / "separated"
    if not separated.is_dir():
        return None
    exact = [p for p in separated.iterdir() if p.is_file() and p.suffix.casefold() in AUDIO_SUFFIXES and p.stem.casefold() == stem.casefold()]
    if exact:
        return exact[0]
    return None


def _song_inputs(song: Path) -> dict[str, Path]:
    items = {
        "original": _find_audio(song, "vocals"),
        "denoise": _find_audio(song, "vocals.midi-analysis"),
        "tail-suppressed": _find_audio(song, "vocals.midi-analysis-tail"),
    }
    missing = [name for name, path in items.items() if path is None]
    if missing:
        raise FileNotFoundError(f"Missing FCPE analysis audio: {', '.join(missing)} in {song / 'separated'}")
    return {name: path for name, path in items.items() if path is not None}


def _compare_pitch(left: list[PitchFrame], right: list[PitchFrame]) -> dict[str, object]:
    count = min(len(left), len(right))
    left = left[:count]
    right = right[:count]
    lv = np.asarray([f.voiced for f in left], dtype=bool)
    rv = np.asarray([f.voiced for f in right], dtype=bool)
    both = lv & rv
    lf = np.asarray([f.frequency for f in left], dtype=np.float64)[both]
    rf = np.asarray([f.frequency for f in right], dtype=np.float64)[both]
    cents = np.abs(1200.0 * np.log2(np.maximum(rf, 1e-12) / np.maximum(lf, 1e-12)))
    return {
        "frames": count,
        "frame_delta": len(right) - len(left),
        "voiced_agreement": float(np.mean(lv == rv)) if count else 1.0,
        "cents_mae": float(np.mean(cents)) if cents.size else 0.0,
        "cents_p95": float(np.percentile(cents, 95)) if cents.size else 0.0,
        "cents_max": float(np.max(cents)) if cents.size else 0.0,
    }


def _candidate_frames(candidate, production: list[PitchFrame], y: np.ndarray, estimator: FCPEPitchEstimator) -> list[PitchFrame]:
    step = estimator.hop / estimator.sr
    energy_window = max(32, int(estimator.sr * 0.025))
    frames: list[PitchFrame] = []
    for index, value in enumerate(candidate.f0):
        hz = float(value)
        valid = bool(np.isfinite(hz) and estimator.fmin <= hz <= estimator.fmax)
        conf = max(0.0, min(1.0, float(candidate.confidence[index]))) if index < len(candidate.confidence) else (1.0 if valid else 0.0)
        voiced = bool(valid and conf >= 0.05)
        start = min(len(y), int(round(index * step * estimator.sr)))
        end = min(len(y), start + energy_window)
        energy = float(np.sqrt(np.mean(np.square(y[start:end])) + 1e-12)) if end > start else (production[index].energy if index < len(production) else 0.0)
        frames.append(PitchFrame(index * step, hz if voiced else 0.0, conf if voiced else 0.0, voiced, energy))
    return frames


def _directml_estimate(source: Path, estimator: FCPEPitchEstimator, backend: OrtDirectMLFCPEBackend, torch) -> tuple[list[PitchFrame], float, tuple[str, ...]]:
    y, sample_rate = load_mono(source, estimator.sr)
    y = np.asarray(y, dtype=np.float32)
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    if peak > 0.999:
        y = np.ascontiguousarray(y * (0.999 / peak), dtype=np.float32)
    model = estimator._model
    tensor = torch.from_numpy(y).unsqueeze(0).unsqueeze(-1)
    started = time.perf_counter()
    with torch.inference_mode():
        mel = model.wav2mel(tensor, sample_rate)
    preprocess = time.perf_counter() - started
    cent_table = np.asarray(model.model.cent_table.detach().float().cpu(), dtype=np.float32)
    target_length = (len(y) // estimator.hop) + 1
    candidate = backend.infer(np.asarray(mel.detach().cpu(), dtype=np.float32), cent_table, target_length=target_length)
    # The production list is used only as an energy fallback for pathological empty windows.
    frames = _candidate_frames(candidate, [], y, estimator)
    return frames, preprocess + candidate.inference_sec, candidate.providers


def _finalize_pitch(candidates: dict[str, list[PitchFrame]], sources: dict[str, Path], config: CoreConfig) -> tuple[str, list[PitchFrame], dict[str, object]]:
    qualities = {name: score_pitch_track(list(value)) for name, value in candidates.items()}
    selected = choose_best_pitch_track(qualities)
    raw = list(candidates[selected])
    source = sources[selected]
    confidence = refine_pitch_confidence(raw, source, sample_rate=config.pitch_sample_rate)
    fused = fuse_pitch_with_yin(
        confidence,
        source,
        sample_rate=config.pitch_sample_rate,
        fmin_hz=config.fmin_hz,
        fmax_hz=config.fmax_hz,
    )
    return selected, stabilize_pitch(fused), {name: to_dict(value) for name, value in qualities.items()}


def _note_metrics(left: list[dict], right: list[dict]) -> dict[str, object]:
    count = min(len(left), len(right))
    starts = []
    ends = []
    pitches = []
    for a, b in zip(left[:count], right[:count]):
        starts.append(abs(float(a.get("start", 0.0)) - float(b.get("start", 0.0))))
        ends.append(abs(float(a.get("end", 0.0)) - float(b.get("end", 0.0))))
        pitches.append(abs(float(a.get("midi_note", 0.0)) - float(b.get("midi_note", 0.0))))
    return {
        "count_left": len(left),
        "count_right": len(right),
        "count_delta": len(right) - len(left),
        "max_start_sec": max(starts, default=0.0),
        "max_end_sec": max(ends, default=0.0),
        "max_pitch": max(pitches, default=0.0),
        "exact_json": _canonical(left) == _canonical(right),
    }


def _load_notes(path: Path, key: str = "notes") -> list[dict]:
    payload = read_json(path, {})
    return list(payload.get(key, [])) if isinstance(payload, dict) else []


def _baseline_source(song: Path) -> str | None:
    diagnostics = read_json(song / "diagnostics.json", {})
    value = ((diagnostics.get("data_flow") or {}).get("pitch_analysis_source") if isinstance(diagnostics, dict) else None)
    return str(value) if value else None


def _derive(song: Path, pitch: list[PitchFrame], tail_audio: Path, config: CoreConfig, root: Path) -> dict[str, object]:
    words_payload = read_json(song / "lyricsSync.json", {})
    words = [Word(**item) for item in words_payload.get("words", [])]
    lyrics = (song / "lyrics.txt").read_text(encoding="utf-8")
    music = read_json(song / "music.json", {})
    bpm = int(round(float(music.get("bpm") or 120.0)))
    song_audio = next((p for p in (song / "song.wav", song / "song.flac") if p.is_file()), None)
    song_duration = duration(song_audio) if song_audio else (max((w.end for w in words), default=0.0))

    syllables = align_syllables(words, pitch)
    vocal_notes = build_vocal_notes(
        pitch,
        syllables,
        min_note=config.min_note_sec,
        split_semitones=config.split_note_semitones,
        max_gap=config.max_gap_sec,
        min_confidence=config.min_voiced_confidence,
        words=words,
        audio=tail_audio,
        activity_segments=(),
        fmin_hz=config.fmin_hz,
        fmax_hz=config.fmax_hz,
    )
    game_notes = build_game_notes(vocal_notes, syllables, min_note=config.min_note_sec)
    root.mkdir(parents=True, exist_ok=True)
    vocal_midi = root / "vocal.mid"
    game_midi = root / "game.mid"
    if vocal_notes:
        write_midi(vocal_midi, vocal_notes, words, syllables, bpm, True, config.midi_bend_range)
        write_midi(game_midi, game_notes or vocal_notes, words, syllables, bpm, False, config.midi_bend_range)
    song_map = build_karaoke_song_map(
        lyrics_text=lyrics,
        words=words,
        syllables=syllables,
        game_notes=game_notes,
        duration=song_duration,
        bpm=bpm,
        key=music.get("key"),
        ai_build_id=AI_BUILD_ID,
        note_decoder_version=NOTE_DECODER_VERSION,
    )
    quality = to_dict(evaluate_quality(song_duration, pitch, words, syllables, vocal_notes))
    data = {
        "syllables": [to_dict(x) for x in syllables],
        "acousticNotes": [to_dict(x) for x in vocal_notes],
        "reference": [to_dict(x) for x in game_notes],
        "songMap": song_map,
        "quality": quality,
        "vocalMidi": _sha256(vocal_midi) if vocal_midi.is_file() else None,
        "gameMidi": _sha256(game_midi) if game_midi.is_file() else None,
    }
    write_json_atomic(root / "candidate-summary.json", data)
    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("song", type=Path, nargs="?")
    parser.add_argument("--json-output", type=Path)
    args = parser.parse_args()
    song = args.song.expanduser().resolve() if args.song else _find_latest_song()
    if song is None or not song.is_dir():
        print("[FAIL] No processed song directory with pitch.json/lyricsSync.json/music.json was found.", file=sys.stderr)
        return 2

    baseline_source = _baseline_source(song)
    if baseline_source not in FCPE_SOURCES:
        print(f"[FAIL] This song is not an FCPE fallback baseline (pitch_analysis_source={baseline_source!r}).", file=sys.stderr)
        print("       Process a song whose diagnostics.json reports original/denoise/tail-suppressed.", file=sys.stderr)
        return 3

    sources = _song_inputs(song)
    directml = ROOT / "downloads/runtimes/onnxruntime-directml"
    artifact = ROOT / "downloads/models/optimized/fcpe/fcpe-core.onnx"
    if not directml.is_dir() or not artifact.is_file():
        print("[FAIL] DirectML runtime/artifact is not prepared. Run scripts\\test-directml-isolation.bat first.", file=sys.stderr)
        return 4
    os.environ["KARAOKE_AI_ORT_DIRECTML_PATH"] = str(directml)
    os.environ["KARAOKE_AI_FCPE_ONNX"] = str(artifact)
    if str(directml) not in sys.path:
        sys.path.insert(0, str(directml))

    previous = {name: os.environ.get(name) for name in ("SONGAPP_DEVICE", "KARAOKE_AI_FCPE_SHADOW")}
    os.environ["SONGAPP_DEVICE"] = "cpu"
    os.environ["KARAOKE_AI_FCPE_SHADOW"] = "0"
    runtime.reset_runtime_for_tests()
    runtime.configure_runtime("cpu", force=True)

    config = CoreConfig.from_env()
    estimator = FCPEPitchEstimator(sr=config.pitch_sample_rate, hop=max(1, int(config.pitch_sample_rate * config.hop_seconds)), fmin=config.fmin_hz, fmax=config.fmax_hz)
    backend = OrtDirectMLFCPEBackend(artifact)
    try:
        estimator._load_model()
        if estimator._device != "cpu":
            raise RuntimeError(f"PyTorch reference unexpectedly selected {estimator._device}")
        import torch

        pytorch_candidates: dict[str, list[PitchFrame]] = {}
        dml_candidates: dict[str, list[PitchFrame]] = {}
        pytorch_times = {}
        dml_times = {}
        providers: set[str] = set()
        for name, source in sources.items():
            started = time.perf_counter()
            pytorch_candidates[name] = estimator.estimate(source)
            pytorch_times[name] = time.perf_counter() - started
            dml_candidates[name], dml_times[name], active = _directml_estimate(source, estimator, backend, torch)
            providers.update(active)

        pytorch_selected, pytorch_pitch, pytorch_quality = _finalize_pitch(pytorch_candidates, sources, config)
        dml_selected, dml_pitch, dml_quality = _finalize_pitch(dml_candidates, sources, config)
        baseline_pitch = [PitchFrame(**item) for item in read_json(song / "pitch.json", [])]
        baseline_match = _compare_pitch(baseline_pitch, pytorch_pitch)
        pitch_compare = _compare_pitch(pytorch_pitch, dml_pitch)

        with tempfile.TemporaryDirectory(prefix="directml-downstream-") as temp:
            temp_root = Path(temp)
            rebuilt = _derive(song, pytorch_pitch, sources["tail-suppressed"], config, temp_root / "pytorch")
            candidate = _derive(song, dml_pitch, sources["tail-suppressed"], config, temp_root / "directml")

        baseline = {
            "syllables": list(read_json(song / "syllables.json", {}).get("syllables", [])),
            "acousticNotes": _load_notes(song / "acousticNotes.json"),
            "reference": _load_notes(song / "reference.json"),
            "songMap": read_json(song / "songMap.json", {}),
            "quality": read_json(song / "quality.json", {}) if (song / "quality.json").is_file() else {},
            "vocalMidi": _sha256(song / "vocal.mid") if (song / "vocal.mid").is_file() else None,
            "gameMidi": _sha256(song / "game.mid") if (song / "game.mid").is_file() else None,
        }

        baseline_reproduction = {
            "syllables_exact": _canonical(baseline["syllables"]) == _canonical(rebuilt["syllables"]),
            "acousticNotes": _note_metrics(baseline["acousticNotes"], rebuilt["acousticNotes"]),
            "reference": _note_metrics(baseline["reference"], rebuilt["reference"]),
            "vocalMidi_exact": baseline["vocalMidi"] == rebuilt["vocalMidi"],
            "gameMidi_exact": baseline["gameMidi"] == rebuilt["gameMidi"],
            "songMap_exact": _canonical(baseline["songMap"]) == _canonical(rebuilt["songMap"]),
            "quality_exact": (not baseline["quality"]) or _canonical(baseline["quality"]) == _canonical(rebuilt["quality"]),
        }
        comparisons = {
            "syllables_exact": _canonical(rebuilt["syllables"]) == _canonical(candidate["syllables"]),
            "acousticNotes": _note_metrics(rebuilt["acousticNotes"], candidate["acousticNotes"]),
            "reference": _note_metrics(rebuilt["reference"], candidate["reference"]),
            "vocalMidi_exact": rebuilt["vocalMidi"] == candidate["vocalMidi"],
            "gameMidi_exact": rebuilt["gameMidi"] == candidate["gameMidi"],
            "songMap_exact": _canonical(rebuilt["songMap"]) == _canonical(candidate["songMap"]),
            "quality_exact": _canonical(rebuilt["quality"]) == _canonical(candidate["quality"]),
        }
        provider_pass = "DmlExecutionProvider" in providers
        baseline_reference_pass = (
            baseline_match["frame_delta"] == 0
            and baseline_match["voiced_agreement"] >= 0.99999
            and baseline_match["cents_p95"] <= 0.05
            and baseline_reproduction["syllables_exact"]
            and baseline_reproduction["acousticNotes"]["exact_json"]
            and baseline_reproduction["reference"]["exact_json"]
            and baseline_reproduction["vocalMidi_exact"]
            and baseline_reproduction["gameMidi_exact"]
            and baseline_reproduction["songMap_exact"]
            and baseline_reproduction["quality_exact"]
        )
        pitch_pass = (
            pitch_compare["frame_delta"] == 0
            and pitch_compare["voiced_agreement"] >= 0.99999
            and pitch_compare["cents_p95"] <= 0.05
            and pitch_compare["cents_max"] <= 1.0
        )
        downstream_pass = (
            comparisons["syllables_exact"]
            and comparisons["acousticNotes"]["exact_json"]
            and comparisons["reference"]["exact_json"]
            and comparisons["vocalMidi_exact"]
            and comparisons["gameMidi_exact"]
            and comparisons["songMap_exact"]
            and comparisons["quality_exact"]
        )
        cpu_total = sum(pytorch_times.values())
        dml_total = sum(dml_times.values())
        speedup = cpu_total / max(dml_total, 1e-9)

        payload = {
            "song": str(song),
            "baseline_pitch_source": baseline_source,
            "pytorch_selected_source": pytorch_selected,
            "directml_selected_source": dml_selected,
            "providers": sorted(providers),
            "pytorch_three_pass_sec": cpu_total,
            "directml_three_pass_preprocess_core_sec": dml_total,
            "speedup": speedup,
            "pytorch_source_times": pytorch_times,
            "directml_source_times": dml_times,
            "baseline_vs_rebuilt_pytorch": baseline_match,
            "pytorch_vs_directml_pitch": pitch_compare,
            "pytorch_source_quality": pytorch_quality,
            "directml_source_quality": dml_quality,
            "baseline_reproduction": baseline_reproduction,
            "downstream": comparisons,
            "decision": {
                "provider_pass": provider_pass,
                "baseline_reference_pass": baseline_reference_pass,
                "pitch_pass": pitch_pass,
                "downstream_pass": downstream_pass,
                "full_gate_pass": provider_pass and baseline_reference_pass and pitch_pass and downstream_pass,
            },
        }

        print("A&D Voice DirectML FCPE FULL downstream gate")
        print(f"Song: {song}")
        print(f"Baseline source: {baseline_source}")
        print(f"Rebuilt PyTorch source: {pytorch_selected}")
        print(f"DirectML source: {dml_selected}")
        print(f"Providers: {', '.join(sorted(providers))}")
        print(f"PyTorch three-pass FCPE: {cpu_total:.4f}s")
        print(f"DirectML three-pass preprocess+core: {dml_total:.4f}s")
        print(f"Core-path speedup: {speedup:.3f}x")
        print("Pitch:", json.dumps(pitch_compare, ensure_ascii=False))
        print("Baseline reproduction:", "PASS" if baseline_reference_pass else "FAIL")
        print("Acoustic notes:", json.dumps(comparisons["acousticNotes"], ensure_ascii=False))
        print("Reference notes:", json.dumps(comparisons["reference"], ensure_ascii=False))
        print("Syllables exact:", comparisons["syllables_exact"])
        print("Vocal MIDI exact:", comparisons["vocalMidi_exact"])
        print("Game MIDI exact:", comparisons["gameMidi_exact"])
        print("SongMap exact:", comparisons["songMap_exact"])
        print("Quality exact:", comparisons["quality_exact"])
        print("\n============================================================")
        print(" DECISION")
        print("============================================================")
        print("DirectML provider       :", "PASS" if provider_pass else "FAIL")
        print("Baseline reproducibility:", "PASS" if baseline_reference_pass else "FAIL")
        print("Pitch gate              :", "PASS" if pitch_pass else "FAIL")
        print("Full downstream gate    :", "PASS" if downstream_pass else "FAIL")
        print("DIRECTML FCPE VALIDATED :", "YES" if payload["decision"]["full_gate_pass"] else "NO")

        target = args.json_output or ROOT / "logs/directml-fcpe-downstream-gate.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"JSON: {target}")
        return 0 if payload["decision"]["full_gate_pass"] else 5
    finally:
        backend.release()
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        runtime.reset_runtime_for_tests()


if __name__ == "__main__":
    raise SystemExit(main())

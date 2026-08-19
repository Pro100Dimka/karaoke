

import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, write_json

import sys
SOURCE = ROOT / "build/ctc-shadow-corpus/ctc-corpus-results.json"
OUTPUT = ROOT / "build/ctc-shadow-corpus/cascade-analysis.json"


def _line_delta(left, right):
    if left is None or right is None: return None
    values = []
    for a, b in zip(left["words"], right["words"]): values.extend((abs(a["start"] - b["start"]), abs(a["end"] - b["end"])))
    return max(values, default=0.0)


def main() -> None:
    payload = json.loads(SOURCE.read_text(encoding="utf-8")); cases = []
    for case in payload["cases"]:
        windows = [
            {
                "window": index,
                "line_start": item.get("line_start"),
                "line_end": item.get("line_end"),
                "frames": item.get("frames"),
                "changed_frames": item.get("argmax_changed_frames", 0),
                "changed_indices": item.get("argmax_changed_indices", []),
                "word_timing_max_ms": item.get("word_timing_max_ms"),
            }
            for index, item in enumerate(case["shadow"].get("windows", []))
            if item.get("status") == "compared" and item.get("argmax_changed_frames", 0)
        ]
        line_deltas = []
        for index, (left, right) in enumerate(
            zip(case["production"], case["candidate"])
        ):
            delta = _line_delta(left, right)
            if (left is None) != (right is None) or (delta or 0) > 1e-9:
                line_deltas.append(
                    {
                        "line": index,
                        "production_present": left is not None,
                        "candidate_present": right is not None,
                        "max_timing_delta_ms": None if delta is None else delta * 1000,
                        "production_last_end": left["words"][-1]["end"]
                        if left
                        else None,
                        "candidate_last_end": right["words"][-1]["end"]
                        if right
                        else None,
                    }
                )
        cases.append(
            {
                "case": case["case"],
                "same_window_core_divergences": windows,
                "sequential_line_divergences": line_deltas,
                "first_core_window": windows[0]["window"] if windows else None,
                "first_sequential_line": line_deltas[0]["line"]
                if line_deltas
                else None,
            }
        )
    write_json(OUTPUT, {"cases": cases}); print(OUTPUT)


if __name__ == "__main__": main()

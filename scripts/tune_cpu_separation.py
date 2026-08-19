
import argparse
import os
import tempfile
from pathlib import Path

from benchmark_cpu_separation import _convert_input, _run_profile


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_FILE = PROJECT_ROOT / "downloads" / "cache" / "ai-runtime" / "cpu-separation-threads.txt"


def _candidate_threads() -> list[int]:
    logical = max(1, os.cpu_count() or 1); raw = [logical, 6, 8, 10, 12, 16, 20]; result: list[int] = []
    for value in raw:
        value = max(1, min(int(value), logical))
        if value not in result: result.append(value)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Find the fastest byte-identical CPU thread count for RoFormer separation."
    )
    parser.add_argument("input", type=Path); parser.add_argument("--seconds", type=float, default=8.0)
    parser.add_argument(
        "--threads",
        default="",
        help="Comma-separated candidates. Default: auto set based on logical CPU count.",
    )
    args = parser.parse_args(argv)

    source = args.input.expanduser().resolve()
    if not source.is_file(): parser.error(f"input file does not exist: {source}")
    if args.seconds <= 0: parser.error("--seconds must be > 0")

    if args.threads.strip():
        candidates: list[int] = []; logical = max(1, os.cpu_count() or 1)
        for item in args.threads.split(","):
            value = max(1, min(int(item.strip()), logical))
            if value not in candidates: candidates.append(value)
    else:
        candidates = _candidate_threads()

    print("A&D Voice CPU separation thread tuner"); print(f"Sample: {args.seconds:g}s"); print("Candidates:", ", ".join(map(str, candidates)))

    with tempfile.TemporaryDirectory(prefix="advoice-cpu-thread-tune-") as temporary:
        root = Path(temporary); mix = root / "sample.wav"; _convert_input(source, mix, args.seconds)

        results = []; reference_hashes: tuple[str, str] | None = None
        for index, threads in enumerate(candidates, 1):
            print(f"\n[{index}/{len(candidates)}] threads={threads}")
            result = _run_profile(
                f"threads-{threads}", mix, root, tuned=True, threads=str(threads)
            )
            hashes = (result["vocals_sha256"], result["instrumental_sha256"])
            if reference_hashes is None:
                reference_hashes = hashes; identical = True
            else:
                identical = hashes == reference_hashes
            result["threads"] = threads; result["identical"] = identical; results.append(result); print(f"      load       : {result['load_sec']:.3f}s")
            print(f"      separation : {result['separation_sec']:.3f}s"); print(f"      output     : {'MATCH' if identical else 'DIFF'}")

        valid = [item for item in results if item["identical"]]
        if not valid:
            print("\n[STOP] No output-identical candidate found; cache was not changed."); return 2

        best = min(valid, key=lambda item: float(item["separation_sec"])); CACHE_FILE.parent.mkdir(parents=True, exist_ok=True); CACHE_FILE.write_text(str(best["threads"]), encoding="ascii")

        print("\n============================================================"); print(" RESULT"); print("============================================================")
        for item in sorted(results, key=lambda row: float(row["separation_sec"])):
            marker = "*" if item is best else " "
            print(
                f"{marker} threads={item['threads']:>2}  separation={item['separation_sec']:.3f}s  "
                f"output={'MATCH' if item['identical'] else 'DIFF'}"
            )
        print(f"\nBest threads: {best['threads']}"); print(f"Saved to: {CACHE_FILE}"); print("start-dev-cpu.bat will use this value automatically."); return 0


if __name__ == "__main__": raise SystemExit(main())

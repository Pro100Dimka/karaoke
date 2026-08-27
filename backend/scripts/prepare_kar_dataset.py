"""CLI entry point for preparing model-training examples from .kar files."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.kar_dataset_service import DATASET_DIR, prepare_kar_file  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path, help="One or more .kar files")
    parser.add_argument("--output", type=Path, default=DATASET_DIR)
    parser.add_argument("--no-download", action="store_true")
    args = parser.parse_args()
    results = []
    for source in args.files:
        try:
            results.append(
                prepare_kar_file(
                    source,
                    output_root=args.output,
                    download_audio=not args.no_download,
                )
            )
        except Exception as exc:  # noqa: BLE001 - batch CLI boundary
            results.append({"file": str(source), "status": "error", "error": str(exc)})
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 1 if any(item.get("status") == "error" for item in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())

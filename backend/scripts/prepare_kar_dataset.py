"""CLI entry point for preparing examples from .kar, karaoke .mid and .kfn files."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.kar_dataset_service import (  # noqa: E402
    DATASET_DIR,
    MidiSkipped,
    prepare_kar_file,
)
from app.services.kfn_dataset_service import KfnSkipped, prepare_kfn_file  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path, help="One or more .kar/.mid/.kfn files")
    parser.add_argument("--output", type=Path, default=DATASET_DIR)
    parser.add_argument("--no-download", action="store_true")
    args = parser.parse_args()
    results = []
    for source in args.files:
        try:
            suffix = source.suffix.casefold()
            if suffix in {".kar", ".mid"}:
                result = prepare_kar_file(
                    source,
                    output_root=args.output,
                    download_audio=not args.no_download,
                )
            elif suffix == ".kfn":
                result = prepare_kfn_file(source, output_root=args.output)
            else:
                raise ValueError("Поддерживаются только файлы .kar, .mid и .kfn")
            results.append(result)
        except (MidiSkipped, KfnSkipped) as exc:
            results.append({"file": str(source), "status": "skipped", "error": str(exc)})
        except Exception as exc:  # noqa: BLE001 - batch CLI boundary
            results.append({"file": str(source), "status": "error", "error": str(exc)})
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 1 if any(item.get("status") == "error" for item in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())

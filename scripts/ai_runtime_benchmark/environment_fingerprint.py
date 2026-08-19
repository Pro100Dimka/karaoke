
import argparse
import importlib.metadata as metadata
import json
from pathlib import Path

PACKAGES = (
    "numpy",
    "scipy",
    "protobuf",
    "ml-dtypes",
    "tensorflow",
    "torch",
)


def snapshot() -> dict[str, str]:
    result: dict[str, str] = {}
    for name in PACKAGES:
        try: result[name] = metadata.version(name)
        except metadata.PackageNotFoundError: result[name] = "<not-installed>"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--output", type=Path); args = parser.parse_args(); payload = json.dumps(snapshot(), ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__": raise SystemExit(main())

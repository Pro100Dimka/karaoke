from __future__ import annotations

import argparse
import json

from .pipeline import KaraokePipeline, PipelineRequest


def main(argv=None):
    p = argparse.ArgumentParser(description="A&D Voice AI Core")
    p.add_argument("--input", "--source", dest="source", required=True)
    p.add_argument("--output", "--out", dest="output", required=True)
    p.add_argument("--language")
    p.add_argument("--lyrics")
    p.add_argument("--bpm", type=float)
    p.add_argument("--key")
    args = p.parse_args(argv)
    result = KaraokePipeline().run(
        PipelineRequest(
            source_path=args.source,
            output_dir=args.output,
            language=args.language,
            lyrics_path=args.lyrics,
            bpm_override=args.bpm,
            key_override=args.key,
        )
    )
    print(
        json.dumps(
            {"status": "ok", "manifest": str(result.manifest_path), "warnings": result.warnings},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()

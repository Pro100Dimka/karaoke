import argparse
import json

from .pipeline import KaraokePipeline, PipelineRequest


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", "--source", dest="source", required=True)
    parser.add_argument("--output", "--out", dest="output", required=True)
    parser.add_argument("--language")
    parser.add_argument("--lyrics")
    parser.add_argument("--title")
    parser.add_argument("--mode", default="auto")
    args = parser.parse_args(argv)
    result = KaraokePipeline().run(PipelineRequest(
        args.source, args.output, args.language, args.lyrics,
        title=args.title, processing_mode=args.mode,
    ))
    print(json.dumps({"status": "ok", "manifest": str(result.manifest_path)}))


if __name__ == "__main__":
    main()

from __future__ import annotations
import argparse,json
from .pipeline import KaraokePipeline,PipelineRequest

def main(argv=None):
    p=argparse.ArgumentParser(description='Karaoke AI Core 2026')
    p.add_argument('--input','--source',dest='source',required=True)
    p.add_argument('--output','--out',dest='output',required=True)
    p.add_argument('--language',default='ru')
    p.add_argument('--lyrics')
    args=p.parse_args(argv)
    result=KaraokePipeline().run(PipelineRequest(args.source,args.output,args.language,args.lyrics))
    print(json.dumps({'status':'ok','manifest':str(result.manifest_path),'warnings':result.warnings},ensure_ascii=False))
if __name__=='__main__':main()

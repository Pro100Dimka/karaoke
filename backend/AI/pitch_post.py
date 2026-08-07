from __future__ import annotations
import math, statistics
from .models import PitchFrame


def _midi(hz: float) -> float:
    return 69+12*math.log2(hz/440.0)


def stabilize_pitch(frames: list[PitchFrame], max_octave_jump=10.5) -> list[PitchFrame]:
    """Conservative cleanup: fix only isolated octave errors and one-frame holes.

    It intentionally does not median-smooth the contour, preserving vibrato, slides and melismas.
    """
    if len(frames)<3: return frames
    out=list(frames)
    for i in range(1,len(frames)-1):
        prev,cur,nxt=out[i-1],out[i],out[i+1]
        if not cur.voiced and prev.voiced and nxt.voiced and nxt.time-prev.time<=0.035:
            if abs(_midi(prev.frequency)-_midi(nxt.frequency))<0.6:
                hz=math.sqrt(prev.frequency*nxt.frequency)
                out[i]=PitchFrame(cur.time,hz,min(prev.confidence,nxt.confidence)*0.85,True,cur.energy)
                continue
        if cur.voiced and prev.voiced and nxt.voiced:
            pm,cm,nm=_midi(prev.frequency),_midi(cur.frequency),_midi(nxt.frequency)
            if abs(pm-nm)<0.7 and abs(cm-(pm+nm)/2)>max_octave_jump:
                candidates=[cur.frequency/2,cur.frequency*2]
                best=min(candidates,key=lambda hz:abs(_midi(hz)-(pm+nm)/2))
                out[i]=PitchFrame(cur.time,best,cur.confidence*0.9,True,cur.energy)
    return out

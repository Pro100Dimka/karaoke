import json
import statistics

pitch = json.load(open("Song/tritia-31/pitch.json", encoding="utf-8"))
reference = json.load(open("Song/tritia-31/reference.json", encoding="utf-8"))
lyrics = json.load(open("Song/tritia-31/lyricsSync.json", encoding="utf-8"))
step = statistics.median(
    pitch[index + 1]["time"] - pitch[index]["time"]
    for index in range(len(pitch) - 1)
)

def in_lyrics(time):
    return any(line["start"] <= time < line["end"] for line in lyrics)

def in_reference(time):
    return any(note["start"] <= time < note["end"] for note in reference)

lyric_frames = [frame for frame in pitch if in_lyrics(frame["time"])]
missing = [frame for frame in lyric_frames if not in_reference(frame["time"])]
print("frame step:", step)
print("lyrics frames:", len(lyric_frames))
print("covered:", len(lyric_frames) - len(missing))
print("missing:", len(missing))
print("raw voiced in missing:", sum(bool(frame.get("voiced") and frame.get("note")) for frame in missing))
print("median confidence of missing:", statistics.median(frame["confidence"] for frame in missing))

runs = []
start = previous = None
for frame in missing:
    time = frame["time"]
    if start is None or time - previous > step * 1.5:
        if start is not None:
            runs.append((start, previous))
        start = time
    previous = time
if start is not None:
    runs.append((start, previous))
print("largest gaps:")
for start, end in sorted(runs, key=lambda item: item[1] - item[0], reverse=True)[:15]:
    gap = [frame for frame in missing if start <= frame["time"] <= end]
    voiced = [frame for frame in gap if frame.get("voiced") and frame.get("note")]
    median_confidence = statistics.median([frame["confidence"] for frame in voiced]) if voiced else 0
    print(round(end - start + step, 2), round(start, 2), round(end, 2), len(voiced), round(median_confidence, 3))

# Vocal MIDI v7

- `melody.mid` is generated directly from `pitch.json` and `lyricsSync.json`.
- Every timed word creates a MIDI lyric event and an explicit note retrigger.
- Stable pitch changes inside a word become separate MIDI notes.
- Vibrato, slides and microtonal intonation are preserved as pitch-bend events.
- MIDI timing is not quantized; it follows the vocal recording.
- `reference.json` remains the simplified gameplay/scoring representation.

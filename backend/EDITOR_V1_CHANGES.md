# Karaoke Melody Editor v1

- Added GET/PUT `/songs/{song_id}/editor` and POST `/songs/{song_id}/editor/reset`.
- Manual note edits become the runtime SongMap/reference/game.mid source.
- First save creates `songMap.ai.json`; reset restores the AI baseline.
- A fresh AI SongMap removes an old editor backup.
- Removed automatic diagnostic.mp3 generation; the editor replaces that workflow.
- Added editor service regression tests.

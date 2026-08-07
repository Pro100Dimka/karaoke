# AI Core 2026 backend integration

The backend uses `app.services.ai_bridge` as the only integration point with the
new `AI` package. Legacy `run_all/src/...`, Whisper and Demucs imports are no
longer used.

Required production environment variables for separation/model locations remain
those supported by AI Core v2.0 (`MSST_INFERENCE_COMMAND`, `MSST_CONFIG`,
`MSST_CHECKPOINT`, `KARAOKE_AI_ASR_MODEL`, `KARAOKE_AI_ALIGNER_MODEL`).
Model weights are external runtime data and are intentionally not bundled by
`KaraokeBackend.spec`.

The current frontend still consumes several legacy filenames. After each AI run
the bridge generates lightweight compatibility artefacts: `lyrics.json`,
`songInfo.json`, `difficulty.json`, `structure.json`, and `breaths.json`. Canonical
AI files (`lyricsSync.json`, `songMap.json`, object-shaped `reference.json`) are
left untouched so caching remains valid.

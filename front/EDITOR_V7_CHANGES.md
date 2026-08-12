# Editor V7

- Modifier shortcuts now consume the browser event exactly once. Ctrl+wheel and Ctrl+Shift+wheel no longer trigger native/browser zoom or a second editor action.
- Editor keyboard commands are handled in capture phase with explicit priority; Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, Ctrl+A/C/X/V/D/S, Delete, Space and arrows no longer bubble into other handlers.
- Ctrl+Z / Ctrl+Shift+Z work even when the syllable select still owns focus.
- Playhead is polled continuously from the master instrumental audio with requestAnimationFrame, so it moves while audio is playing instead of jumping only after pause.
- Playhead remains draggable horizontally and gets a larger premium grab handle.
- Removed duplicate song title from the editor header; SongStrip is the single song identity surface.
- Increased SongStrip height and visual weight.
- Moved command buttons to the far right of the top deck and restyled back/tool buttons to match the app theme.
- Increased Cubase-style zoom slider sizes and scrollbar tracks.
- Reduced default vertical piano-roll zoom from 20 to 14 and allowed 10..36 range, reducing oversized row gaps.
- Tightened note height and piano-key proportions.
- Replaced click-like audition tone with a soft musical multi-partial synth (sine + triangle harmonics, low-pass filter, attack/decay envelope).
- Audition remains active on piano-key click, note click, drag, resize, keyboard nudge and transpose.

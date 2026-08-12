# Editor V12

- Restored marquee multi-selection with live highlighting during drag.
- Selection hit-testing is extracted and tested against piano-roll content coordinates.
- Horizontal zoom commits React layout synchronously and compensates scroll before browser paint.
- Vertical zoom uses the note nearest the viewport center as an exact screen-position anchor and compensates in the same frame.
- Editor SongStrip no longer repeats cover/title/artist; only waveform and timecodes remain.
- Selected notes have a stronger visible state.

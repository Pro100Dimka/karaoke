# Editor V10

- Timeline 0:00 starts immediately after the piano keyboard.
- Horizontal and vertical zoom keep the current playhead/viewport anchor instead of jumping.
- Added auto-scroll transport mode: follows the playhead after the viewport midpoint and returns to the playback origin on Stop.
- Plain Left/Right selects previous/next note; Ctrl+Left/Right moves selected notes in time. Up/Down transposes as before.
- Merging notes merges their lyric fragments in chronological order.
- Deleting notes transfers their lyric text to the nearest remaining note without changing its timing/pitch.
- Manual merged text and source syllable indices persist through backend saves.
- Left resize can extend notes to the previous boundary.
- Drag and resize are collision constrained so notes cannot overlap neighboring notes.
- Melody monitor level increased.
- Playhead visual updates no longer get overwritten by React state while playing.

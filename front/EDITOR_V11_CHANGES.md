# Editor V11

- Reordered the top editor controls: Back, Save, Undo, Redo, Restore AI, Auto-scroll, Play/Stop, Merge, Delete.
- Removed Add and pitch Up/Down toolbar buttons.
- Grouped controls into visual studio groups.
- Monitoring dials now follow the toolbar, then SongStrip, then note/text assignment.
- Header now shows `<song title> · VOCAL MELODY EDITOR`.
- Vertical zoom anchors to the MIDI note nearest the viewport center and preserves its screen position.
- Playhead dragging uses short note audition previews and never starts the persistent playback synth while stopped.
- Stopped seek auditions are finite; resumed playback avoids a double preview before transport restarts.

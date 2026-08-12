# Editor V9

- Ctrl+Wheel / Ctrl+Shift+Wheel are captured at window level over the piano roll and prevent browser/default double actions.
- Keyboard shortcuts use physical KeyboardEvent.code so Ctrl+Z / Ctrl+Shift+Z work independently of keyboard layout.
- Playhead uses a monotonic performance clock and direct GPU transform updates instead of React/layout-driven left changes.
- Playhead dragging previews visually and commits the media seek on pointer release, avoiding seek-per-pixel stutter.
- Voice playback drift is corrected against the instrumental master without constant hard seeking.
- Melody monitoring level is increased.
- Piano white-key geometry is gapless and based on midpoints between neighboring natural notes; black keys overlay it.
- Toolbar SVG icons are explicitly centered.
- Removed roll padding that created dead space around the custom Cubase scroll tracks.

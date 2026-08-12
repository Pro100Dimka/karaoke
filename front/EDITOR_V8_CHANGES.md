# Editor V8

- Frame-perfect playhead: visual position is written directly to a CSS custom property every requestAnimationFrame.
- React state for labels is throttled separately, so React renders no longer gate the moving line.
- Seeking/dragging updates the visual playhead immediately.
- Toolbar buttons are round and use karaoke-console-like functional color families.

# Editor V4 changes

- Added BackendBootLoader: application UI mounts only after `/diagnostics/health` succeeds; startup network errors no longer leak as `Failed to fetch`.
- Theme-aware animated SVG loader uses the existing dark/light/violet/green app icons and theme colors.
- Rebuilt editor layout with compact left control rail for icon buttons and Vocal/Melody/Instrumental dials.
- Compressed editor header and SongStrip to preserve more piano-roll workspace.
- Rebuilt piano keyboard as layered white keys with shorter black keys on top, matching the Karaoke MelodyRoll piano visual language.
- Fixed repeated syllable text: only one canonical note for a syllable renders its text label even when notes are resized/overlap.
- Added independent horizontal and vertical Cubase-style zoom sliders fixed at the bottom-right of the editor.
- Narrowed inspector panel.
- Preserved Editor V3 multi-select, marquee, group drag, Shift horizontal lock, keyboard nudging, copy/paste, Undo/Redo and save behavior.
- Preserved modal overflow containment fixes from V2/V3.

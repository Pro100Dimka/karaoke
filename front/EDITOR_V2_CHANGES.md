# Editor V2

- Melody editor is now a dedicated full-screen `/editor/:songId` workspace instead of a nested modal.
- Toolbar uses one compact row of icon buttons.
- Editor transport now reuses Karaoke `SongStrip`.
- Vocal, Melody, Instrumental and Zoom use Karaoke-style rotary `EffectDial` controls.
- Piano roll has a sticky Cubase-like piano keyboard on the left and a dedicated inspector on the right.
- Shared Modal now wraps content in `app-modal-body`; oversized content scrolls inside the card instead of escaping it.
- Existing editor backend contract and save/reset behavior are unchanged.

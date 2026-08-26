; The packaged backend stores the user's song library, database, recordings
; and downloaded AI models under "$INSTDIR\data" (see backend/config.py's
; _default_data_dir/_default_models_dir). electron-builder's stock uninstaller
; recursively deletes the whole install directory ("RMDir /r $INSTDIR"),
; which would silently wipe that user data along with the application
; binaries. Move "data" out of the way before that happens so a normal
; uninstall never touches it.
!macro customUnInstall
  IfFileExists "$INSTDIR\data\*.*" 0 advoice_data_done
    CreateDirectory "$LOCALAPPDATA\A&D Voice"
    ClearErrors
    Rename "$INSTDIR\data" "$LOCALAPPDATA\A&D Voice\data"
    IfErrors 0 advoice_data_done
      ; Cross-volume rename or a locked file -- fall back to a sibling
      ; folder next to $INSTDIR, guaranteed to be on the same drive.
      ClearErrors
      Rename "$INSTDIR\data" "$INSTDIR\..\A&D Voice-data"
  advoice_data_done:
!macroend

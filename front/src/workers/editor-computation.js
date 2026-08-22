import { normalizeNotes } from "../pages/MelodyEditor/model.js";
import { flattenLyricsNotes } from "../utils/lyrics-sync";

export const prepareEditorNotes = (lyricsSync) => normalizeNotes(flattenLyricsNotes(lyricsSync));

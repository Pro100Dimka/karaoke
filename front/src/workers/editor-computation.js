import { normalizeNotes, recombineAdjacentEqualPitchNotes } from "../pages/MelodyEditor/model.js";
import { flattenLyricsNotes } from "../utils/lyrics-sync";

export const prepareEditorNotes = (lyricsSync) =>
  normalizeNotes(recombineAdjacentEqualPitchNotes(flattenLyricsNotes(lyricsSync)));

export function shouldLoadKaraokeResult(song) {
  return Boolean(song?.id && song.status === "done");
}

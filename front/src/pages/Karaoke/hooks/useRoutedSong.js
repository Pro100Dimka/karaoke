import { useEffect, useState } from "react";
import { api } from "../../../api/client";

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

export default function useRoutedSong(songs, songId) {
  const hasList = Array.isArray(songs);
  const list = hasList ? songs : [];
  const listed =
    songId != null
      ? list.find((song) => sameId(song?.id, songId))
      : list.find((song) => song?.status === "done");
  const [loaded, setLoaded] = useState(null);

  useEffect(() => {
    if (songId == null || !hasList || listed) {
      setLoaded(null);
      return;
    }

    let active = true;
    api.getSong(songId).then(
      (song) => active && setLoaded(song),
      () => active && setLoaded(null)
    );
    return () => {
      active = false;
    };
  }, [hasList, listed?.id, songId]);

  return listed || (sameId(loaded?.id, songId) ? loaded : null);
}

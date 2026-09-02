import { useEffect, useState } from "react";
import { api } from "../../../api/client";

export default function useRoutedSong(songs, songId) {
  const listedSong = songId
    ? (songs || []).find((song) => song.id === songId)
    : (songs || []).find((song) => song.status === "done");
  const [routedSong, setRoutedSong] = useState(null);

  useEffect(() => {
    if (!songId || !songs || listedSong) {
      setRoutedSong(null);
      return undefined;
    }
    let active = true;
    api.getSong(songId).then(
      (loaded) => active && setRoutedSong(loaded),
      () => active && setRoutedSong(null)
    );
    return () => {
      active = false;
    };
  }, [listedSong, songId, songs]);

  return listedSong || (routedSong?.id === songId ? routedSong : null);
}

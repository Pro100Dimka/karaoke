import { useEffect, useState } from "react";
import { api } from "../api/client";

export default function useSongCover(songId, resetKey) {
  const [failed, setFailed] = useState(false);
  const coverUrl = songId ? api.getSongCoverUrl(songId, resetKey) : "";
  useEffect(() => setFailed(false), [coverUrl, resetKey]);
  return {
    coverUrl,
    hasCover: Boolean(coverUrl) && !failed,
    handleCoverError: () => setFailed(true)
  };
}

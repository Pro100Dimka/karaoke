import { useEffect, useState } from "react";
import { api } from "../../../api/client";

/**
 * Resolves a song's extracted cover art URL and tracks whether the image
 * failed to load, so callers can fall back to a placeholder icon.
 *
 * `resetKey` lets a caller force-clear a stale failure when the underlying
 * song identity changes without its id changing (e.g. an online-room song
 * swap that reuses the same id) -- without it, a permanently-broken cover
 * from a previous song could keep the fallback stuck even after a fresh
 * cover becomes available under the same url.
 */
export default function useSongCover(songId, resetKey) {
  const [failed, setFailed] = useState(false);
  const coverUrl = songId ? api.getSongCoverUrl(songId) : "";
  useEffect(() => setFailed(false), [coverUrl, resetKey]);
  return {
    coverUrl,
    hasCover: Boolean(coverUrl) && !failed,
    handleCoverError: () => setFailed(true)
  };
}

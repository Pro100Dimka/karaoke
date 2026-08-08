import { useEffect, useState } from "react";
import { api } from "../../../api/client";
import { shouldLoadKaraokeResult } from "../utils/result";

export default function useKaraokeResult(song) {
  const [result, setResult] = useState(null);
  const songId = song?.id;
  const songStatus = song?.status;

  useEffect(() => {
    if (!shouldLoadKaraokeResult({ id: songId, status: songStatus })) {
      setResult(null);
      return undefined;
    }

    let active = true;
    api
      .getResult(songId)
      .then((nextResult) => {
        if (active) setResult(nextResult);
      })
      .catch(() => {
        if (active) setResult(null);
      });

    return () => {
      active = false;
    };
  }, [songId, songStatus]);

  return result;
}

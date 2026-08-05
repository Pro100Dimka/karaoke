import { useEffect, useState } from "react";
import { api } from "../../../api/client";
import { shouldLoadKaraokeResult } from "../utils/result";

export default function useKaraokeResult(song) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!shouldLoadKaraokeResult(song)) {
      setResult(null);
      return undefined;
    }

    let active = true;
    api
      .getResult(song.id)
      .then((nextResult) => {
        if (active) setResult(nextResult);
      })
      .catch(() => {
        if (active) setResult(null);
      });

    return () => {
      active = false;
    };
  }, [song?.id, song?.status]);

  return result;
}

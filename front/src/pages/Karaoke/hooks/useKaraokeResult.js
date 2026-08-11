import { useEffect, useState } from "react";
import { api } from "../../../api/client";
import { shouldLoadKaraokeResult } from "../utils/result";

export default function useKaraokeResult(song) {
  const [state, setState] = useState({
    result: null,
    loading: false,
    error: null
  });
  const songId = song?.id;
  const songStatus = song?.status;
  const songUpdatedAt = song?.updated_at;

  useEffect(() => {
    if (!shouldLoadKaraokeResult({ id: songId, status: songStatus })) {
      setState({ result: null, loading: false, error: null });
      return undefined;
    }

    let active = true;
    setState({ result: null, loading: true, error: null });

    api.getResult(songId).then(
      (result) => {
        if (active) setState({ result, loading: false, error: null });
      },
      (error) => {
        if (active) setState({ result: null, loading: false, error });
      }
    );

    return () => {
      active = false;
    };
  }, [songId, songStatus, songUpdatedAt]);

  return state;
}

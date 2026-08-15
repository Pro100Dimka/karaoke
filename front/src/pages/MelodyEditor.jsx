import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { translateSaved } from "../i18n/runtime";
import MelodyEditor from "./Library/modals/song-settings/melody-editor";

export default function MelodyEditorPage() {
  const { songId } = useParams();
  const navigate = useNavigate();
  const [song, setSong] = useState(null);
  useEffect(() => {
    let alive = true;
    api
      .listSongs()
      .then((songs) => {
        if (!alive) return;
        setSong(
          (songs || []).find((item) => String(item.id) === String(songId)) || {
            id: songId,
            title: translateSaved("Редактор мелодии")
          }
        );
      })
      .catch(() => alive && setSong({ id: songId, title: translateSaved("Редактор мелодии") }));
    return () => {
      alive = false;
    };
  }, [songId]);
  if (!song)
    return (
      <div className="melody-editor-route-loading">{translateSaved("Открываем редактор…")}</div>
    );
  return <MelodyEditor song={song} onClose={() => navigate("/")} />;
}

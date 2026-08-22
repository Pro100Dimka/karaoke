import { useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import { translateSaved as t } from "../../../i18n/runtime";
import { Box } from "../../../theme/ui";
import { playbackGain, youTubeEmbedUrl } from "../utils/data";

function useTrack(songId, track) {
  const direct = api.getAudioTrackUrl(songId, track);
  const desktop = globalThis.electronAPI?.isElectron === true;
  const [source, setSource] = useState(desktop ? direct : "");
  useEffect(() => {
    if (desktop) return setSource(direct);
    let active = true;
    let url = "";
    let file;
    api
      .getAudioTrackBlob(songId, track)
      .then((next) => {
        file = next;
        if (!active) return file?.cleanup?.();
        url = URL.createObjectURL(file);
        setSource(url);
      })
      .catch(() => active && setSource(""));
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
      file?.cleanup?.();
    };
  }, [desktop, direct, songId, track]);
  return source;
}

function AudioTrack({ audioRef, songId, track, volume }) {
  const source = useTrack(songId, track);
  const element = useRef(null);
  useEffect(
    () => () => {
      const audio = element.current;
      if (!audio) return;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
    []
  );
  return (
    <Box
      as="audio"
      ref={(node) => {
        if (node) element.current = node;
        audioRef.current = node;
      }}
      src={source || undefined}
      preload="auto"
      sx={{ display: "none" }}
      onLoadedMetadata={(event) => {
        event.currentTarget.volume = playbackGain(volume);
      }}
    />
  );
}

export default function KaraokeMedia({
  instrumentalRef,
  isPlaying,
  musicVolume,
  sendYouTubeCommand,
  song,
  speed,
  syncSecondaryMedia,
  videoRef,
  vocalVolume,
  vocalsRef,
  youTubeClipRef,
  youTubeVideoId
}) {
  const loadYouTube = () => {
    sendYouTubeCommand("mute");
    sendYouTubeCommand("setPlaybackRate", [speed]);
    syncSecondaryMedia(instrumentalRef.current?.currentTime || 0, true);
    if (isPlaying) sendYouTubeCommand("playVideo");
  };
  return (
    <>
      <AudioTrack
        key={`${song.id}:instrumental`}
        audioRef={instrumentalRef}
        songId={song.id}
        track="instrumental"
        volume={musicVolume}
      />
      <AudioTrack
        key={`${song.id}:vocals`}
        audioRef={vocalsRef}
        songId={song.id}
        track="vocals"
        volume={vocalVolume}
      />
      {youTubeVideoId ? (
        <Box
          as="iframe"
          ref={youTubeClipRef}
          src={youTubeEmbedUrl(youTubeVideoId)}
          title={t("Клип: {0}", { 0: song.title })}
          allow="autoplay; encrypted-media; picture-in-picture"
          onLoad={loadYouTube}
          sx={{
            position: "absolute",
            inset: 0,
            inlineSize: "100%",
            blockSize: "100%",
            border: 0,
            opacity: 0,
            pointerEvents: "none"
          }}
        />
      ) : song.video_url ? (
        <Box
          as="video"
          ref={videoRef}
          src={song.video_url}
          preload="metadata"
          muted
          playsInline
          sx={{
            position: "absolute",
            inset: 0,
            inlineSize: "100%",
            blockSize: "100%",
            objectFit: "cover",
            opacity: 0,
            pointerEvents: "none"
          }}
        />
      ) : null}
    </>
  );
}

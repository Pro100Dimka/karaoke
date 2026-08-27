import { useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import { translateSaved as t } from "../../../i18n/runtime";
import { Box } from "../../../theme/ui";
import * as platform from "../../../utils/platform";
import { playbackGain, youTubeEmbedUrl } from "../utils/data";

const noop = () => {};

function useTrack(songId, track) {
  const direct = api.getAudioTrackUrl(songId, track);
  const desktop = platform.isElectron();
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
  useEffect(() => {
    const audio = element.current;
    return () => audio?.pause();
  }, []);
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
  youTubeVideoId,
  onClipAvailabilityChange = noop
}) {
  const [clipFailed, setClipFailed] = useState(false);
  useEffect(() => {
    setClipFailed(false);
    onClipAvailabilityChange(Boolean(youTubeVideoId || song.video_url));
  }, [onClipAvailabilityChange, song.id, song.video_url, youTubeVideoId]);

  useEffect(() => {
    if (!youTubeVideoId || clipFailed) return undefined;
    const receivePlayerEvent = (event) => {
      if (!/^https:\/\/([\w-]+\.)?youtube(?:-nocookie)?\.com$/.test(event.origin)) return;
      if (event.source !== youTubeClipRef.current?.contentWindow) return;
      let message = event.data;
      try {
        if (typeof message === "string") message = JSON.parse(message);
      } catch {
        return;
      }
      if (message?.event !== "onError") return;
      setClipFailed(true);
      onClipAvailabilityChange(false);
    };
    globalThis.addEventListener?.("message", receivePlayerEvent);
    return () => globalThis.removeEventListener?.("message", receivePlayerEvent);
  }, [clipFailed, onClipAvailabilityChange, youTubeClipRef, youTubeVideoId]);

  const loadYouTube = () => {
    sendYouTubeCommand("addEventListener", ["onError"]);
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
      {youTubeVideoId && !clipFailed ? (
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
            zIndex: 0,
            opacity: 1,
            pointerEvents: "none"
          }}
        />
      ) : song.video_url && !clipFailed ? (
        <Box
          as="video"
          ref={videoRef}
          src={song.video_url}
          preload="metadata"
          muted
          playsInline
          onError={() => {
            setClipFailed(true);
            onClipAvailabilityChange(false);
          }}
          sx={{
            position: "absolute",
            inset: 0,
            inlineSize: "100%",
            blockSize: "100%",
            objectFit: "cover",
            zIndex: 0,
            opacity: 1,
            pointerEvents: "none"
          }}
        />
      ) : null}
    </>
  );
}

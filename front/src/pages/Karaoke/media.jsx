import { useContext, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import { AppSettingsContext } from "../../../contexts/app-settings";
import { observeLightingMedia } from "../../../services/keyboardLighting";
import { Box } from "../../../theme/ui";
import * as platform from "../../../utils/platform";
import { playbackGain } from "../utils/data";

const noop = () => {};

function useTrack(songId, track) {
  const desktop = platform.isElectron();
  const [blobUrl, setBlobUrl] = useState("");

  useEffect(() => {
    if (desktop || !songId) {
      setBlobUrl("");
      return;
    }

    let active = true;
    let url;
    let file;

    setBlobUrl("");

    api
      .getAudioTrackBlob(songId, track)
      .then((blob) => {
        file = blob;
        if (!active) return file?.cleanup?.();

        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch(() => active && setBlobUrl(""));

    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
      file?.cleanup?.();
    };
  }, [desktop, songId, track]);

  return desktop && songId ? api.getAudioTrackUrl(songId, track) : blobUrl;
}

function AudioTrack({ audioRef, songId, track, volume }) {
  const settings = useContext(AppSettingsContext)?.settings;
  const src = useTrack(songId, track);
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.volume = playbackGain(volume);
  }, [volume]);

  useEffect(() => {
    if (
      track === "instrumental" &&
      settings?.keyboard_lighting_enabled &&
      settings?.keyboard_lighting_mode === "music"
    ) {
      return observeLightingMedia(ref.current);
    }
  }, [src, track, settings?.keyboard_lighting_enabled, settings?.keyboard_lighting_mode]);

  useEffect(
    () => () => {
      ref.current?.pause();
    },
    []
  );

  return (
    <Box
      as="audio"
      ref={(node) => {
        ref.current = node;
        if (audioRef) audioRef.current = node;
      }}
      src={src || undefined}
      crossOrigin="anonymous"
      preload="auto"
      sx={{ display: "none" }}
    />
  );
}

export default function KaraokeMedia({
  instrumentalRef,
  isPlaying,
  musicVolume,
  song,
  speed,
  syncSecondaryMedia,
  videoRef,
  vocalVolume,
  vocalsRef,
  onClipAvailabilityChange = noop
}) {
  const [clipFailed, setClipFailed] = useState(false);
  const songId = song?.id;
  const clipSource = songId && song?.video_url === "local:clip" ? api.getSongVideoUrl(songId) : "";

  useEffect(() => {
    setClipFailed(false);
    onClipAvailabilityChange(false);
  }, [clipSource, onClipAvailabilityChange]);

  const activateClip = (event) => {
    const video = event.currentTarget;

    video.playbackRate = Number(speed) || 1;
    syncSecondaryMedia?.(instrumentalRef.current?.currentTime || 0, true);
    onClipAvailabilityChange(true);

    if (isPlaying) video.play().catch(noop);
  };

  return (
    <>
      {songId &&
        [
          ["instrumental", instrumentalRef, musicVolume],
          ["vocals", vocalsRef, vocalVolume]
        ].map(([track, audioRef, volume]) => (
          <AudioTrack
            key={`${songId}:${track}`}
            audioRef={audioRef}
            songId={songId}
            track={track}
            volume={volume}
          />
        ))}

      {clipSource && !clipFailed && (
        <Box
          as="video"
          ref={videoRef}
          src={clipSource}
          preload="auto"
          muted
          playsInline
          onLoadedData={activateClip}
          onError={() => {
            setClipFailed(true);
            onClipAvailabilityChange(false);
          }}
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            zIndex: 0,
            pointerEvents: "none"
          }}
        />
      )}
    </>
  );
}

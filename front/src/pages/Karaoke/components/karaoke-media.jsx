import { useContext, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import { Box } from "../../../theme/ui";
import * as platform from "../../../utils/platform";
import { playbackGain } from "../utils/data";
import { AppSettingsContext } from "../../../contexts/app-settings";
import { observeLightingMedia } from "../../../services/keyboardLighting";

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
  const { settings } = useContext(AppSettingsContext) ?? {};
  const source = useTrack(songId, track);
  const element = useRef(null);
  useEffect(() => {
    if (track === "instrumental" && settings?.keyboard_lighting_enabled && settings?.keyboard_lighting_mode === "music")
      return observeLightingMedia(element.current);
    return undefined;
  }, [source, track, settings?.keyboard_lighting_enabled, settings?.keyboard_lighting_mode]);
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
      crossOrigin="anonymous"
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
  song,
  speed,
  syncSecondaryMedia,
  videoRef,
  vocalVolume,
  vocalsRef,
  onClipAvailabilityChange = noop
}) {
  const [clipFailed, setClipFailed] = useState(false);
  const clipSource = song.video_url === "local:clip" ? api.getSongVideoUrl(song.id) : "";
  useEffect(() => {
    setClipFailed(false);
    onClipAvailabilityChange(false);
  }, [clipSource, onClipAvailabilityChange, song.id]);
  const activateClip = (event) => {
    event.currentTarget.playbackRate = speed;
    syncSecondaryMedia(instrumentalRef.current?.currentTime || 0, true);
    onClipAvailabilityChange(true);
    if (isPlaying) Promise.resolve(event.currentTarget.play()).catch(() => {});
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
      {clipSource && !clipFailed ? (
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

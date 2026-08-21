import { useEffect, useState } from "react";
import { api } from "../../../api/client";
import { translateSaved } from "../../../i18n/runtime";
import { playbackGain, youTubeEmbedUrl } from "../utils/data";

function useAudioTrackSource(songId, track) {
  const directUrl = api.getAudioTrackUrl(songId, track);
  const isElectron = globalThis.electronAPI?.isElectron === true;
  const [source, setSource] = useState(isElectron ? directUrl : "");

  useEffect(() => {
    if (isElectron) {
      setSource(directUrl);
      return undefined;
    }
    let active = true;
    let objectUrl = "";
    let file;
    api
      .getAudioTrackBlob(songId, track)
      .then((nextFile) => {
        file = nextFile;
        if (!active) {
          file?.cleanup?.();
          return;
        }
        objectUrl = URL.createObjectURL(file);
        setSource(objectUrl);
      })
      .catch(() => {
        if (active) setSource("");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      file?.cleanup?.();
    };
  }, [directUrl, isElectron, songId, track]);

  return source;
}

function AudioTrack({ track, audioRef, songId, volume }) {
  const source = useAudioTrackSource(songId, track);
  return (
    <audio
      ref={audioRef}
      src={source || undefined}
      preload="auto"
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
  const tracks = [
    ["instrumental", instrumentalRef, musicVolume],
    ["vocals", vocalsRef, vocalVolume]
  ];
  const handleYouTubeLoad = () => {
    sendYouTubeCommand("mute");
    sendYouTubeCommand("setPlaybackRate", [speed]);
    syncSecondaryMedia(instrumentalRef.current?.currentTime || 0, true);
    if (isPlaying) sendYouTubeCommand("playVideo");
  };
  return (
    <>
      {tracks.map(([track, audioRef, volume]) => (
        <AudioTrack
          key={track}
          track={track}
          audioRef={audioRef}
          songId={song.id}
          volume={volume}
        />
      ))}
      {youTubeVideoId ? (
        <iframe
          ref={youTubeClipRef}
          className="karaoke-video karaoke-youtube-video"
          src={youTubeEmbedUrl(youTubeVideoId)}
          title={translateSaved("Клип: {0}", { 0: song.title })}
          allow="autoplay; encrypted-media; picture-in-picture"
          onLoad={handleYouTubeLoad}
        />
      ) : (
        song.video_url && (
          <video
            ref={videoRef}
            className="karaoke-video"
            src={song.video_url}
            preload="metadata"
            muted
            playsInline
          />
        )
      )}
    </>
  );
}

import { api } from "../../../api/client";
import { playbackGain, youTubeEmbedUrl } from "../utils/data";

function AudioTrack({ track, audioRef, songId, volume }) {
  return (
    <audio
      ref={audioRef}
      src={api.getAudioTrackUrl(songId, track)}
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
          title={`Клип: ${song.title}`}
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

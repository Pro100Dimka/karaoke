import { api } from "../../../api/client";
import { playbackGain, youTubeEmbedUrl } from "../utils/data";

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
  return (
    <>
      <audio
        ref={instrumentalRef}
        src={api.getAudioTrackUrl(song.id, "instrumental")}
        preload="auto"
        onLoadedMetadata={(event) => {
          event.currentTarget.volume = playbackGain(musicVolume);
        }}
      />
      <audio
        ref={vocalsRef}
        src={api.getAudioTrackUrl(song.id, "vocals")}
        preload="auto"
        onLoadedMetadata={(event) => {
          event.currentTarget.volume = playbackGain(vocalVolume);
        }}
      />
      {youTubeVideoId ? (
        <iframe
          ref={youTubeClipRef}
          className="karaoke-video karaoke-youtube-video"
          src={youTubeEmbedUrl(youTubeVideoId)}
          title={`Клип: ${song.title}`}
          allow="autoplay; encrypted-media; picture-in-picture"
          onLoad={() => {
            sendYouTubeCommand("mute");
            sendYouTubeCommand("setPlaybackRate", [speed]);
            syncSecondaryMedia(instrumentalRef.current?.currentTime || 0, true);
            if (isPlaying) sendYouTubeCommand("playVideo");
          }}
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

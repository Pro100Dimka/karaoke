import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import useKaraokeAudio from "./hooks/useKaraokeAudio";
import useKaraokeMediaSync from "./hooks/useKaraokeMediaSync";
import useKaraokePreferences from "./hooks/useKaraokePreferences";
import useKaraokeTimeline from "./hooks/useKaraokeTimeline";
import useKaraokeTransport from "./hooks/useKaraokeTransport";
import usePlaybackMachine from "./hooks/usePlaybackMachine";
import KaraokeView from "./karaoke-view";

export default function KaraokeSession({
  song,
  lyricsSync,
  autoStartRequested,
  roomPrepared,
  onOpenAppSettings
}) {
  const onlineRoom = useOnlineRoom();
  const { room, roomUi, syncUi } = onlineRoom;
  const navigate = useNavigate();
  const instrumentalRef = useRef(null);
  const vocalsRef = useRef(null);
  const videoRef = useRef(null);
  const playbackEndedRef = useRef(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const mediaRefs = { instrumentalRef, vocalsRef, videoRef };
  const playback = usePlaybackMachine();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  currentTimeRef.current = currentTime;
  durationRef.current = duration;

  const preferences = useKaraokePreferences({ room, roomUi, syncUi });
  const audio = useKaraokeAudio({
    onlineRoom,
    ...mediaRefs,
    setEffectPreset: preferences.setEffectPreset
  });
  const timeline = useKaraokeTimeline({
    song,
    lyricsSync,
    timingOffsets: preferences.timingOffsets,
    setTimingOffsets: preferences.setTimingOffsets,
    melodyVolume: preferences.melodyVolume,
    keyShift: preferences.keyShift,
    speed: preferences.speed,
    setSpeed: preferences.setSpeed,
    currentTimeRef
  });
  const { syncSecondaryMedia } = useKaraokeMediaSync({
    ...mediaRefs,
    currentTimeRef,
    isPlaying: playback.isPlaying,
    keyShift: preferences.keyShift,
    melodyVolume: preferences.melodyVolume,
    musicVolume: preferences.musicVolume,
    onPlaybackEndedRef: playbackEndedRef,
    setCurrentTime,
    setDuration,
    setIsPlaying: playback.setPlaying,
    silenceMelodyGuide: timeline.silenceMelodyGuide,
    songId: song.id,
    speed: preferences.speed,
    startMelodyGuide: timeline.startMelodyGuide,
    updateMelodyGuide: timeline.updateMelodyGuide,
    vocalVolume: preferences.vocalVolume
  });
  const transport = useKaraokeTransport({
    ...mediaRefs,
    song,
    onlineRoom,
    navigate,
    durationRef,
    currentTime,
    duration,
    isPlaying: playback.isPlaying,
    musicVolume: preferences.musicVolume,
    speed: preferences.speed,
    vocalVolume: preferences.vocalVolume,
    microphoneVolume: audio.microphoneVolume,
    microphoneEffects: audio.microphoneEffects,
    startMelodyGuide: timeline.startMelodyGuide,
    silenceMelodyGuide: timeline.silenceMelodyGuide,
    syncSecondaryMedia,
    setCurrentTime,
    playback,
    releaseMonitoring: audio.releaseMonitoring
  });

  return (
    <KaraokeView
      autoHideEnabled={preferences.autoHideConsole}
      currentTime={currentTime}
      duration={duration}
      isPlaying={playback.isPlaying}
      recordingSessionId={transport.recordingSessionId}
      recordingError={transport.recordingError || audio.error || preferences.persistenceError}
      analysisRecordingId={transport.analysisRecordingId}
      clearAnalysis={transport.clearAnalysis}
      transport={transport}
      sceneOptions={{
        analysisRecordingIdRef: transport.analysisRecordingIdRef,
        autoStartRequested,
        roomPrepared,
        instrumentalRef,
        vocalsRef,
        navigate,
        playbackEndedRef,
        songId: song.id
      }}
      mediaProps={{
        ...mediaRefs,
        isPlaying: playback.isPlaying,
        musicVolume: preferences.musicVolume,
        song,
        speed: preferences.speed,
        syncSecondaryMedia,
        vocalVolume: preferences.vocalVolume
      }}
      performanceProps={{
        getLocalVoiceStream: room ? onlineRoom.getLocalVoiceStream : undefined,
        currentTime,
        currentTimeRef,
        isPlaying: playback.isPlaying,
        keyShift: preferences.keyShift,
        lyricsSync: timeline.displayLyricsSync,
        monitorInputDeviceId: audio.monitorInputDeviceId,
        notes: timeline.displayNotes,
        sceneIntro: {
          title: song.title,
          artist: song.artist,
          genre: song.genre,
          key: timeline.compactKey,
          tempo: timeline.currentTempo,
          difficulty: song.difficulty_override
        },
        songId: song.id,
        showLyrics: preferences.showLyrics,
        showNotes: preferences.showNotes
      }}
      consoleProps={{
        song,
        currentTime,
        duration,
        isPlaying: playback.isPlaying,
        audio,
        timeline,
        preferences,
        transport,
        onOpenAppSettings
      }}
    />
  );
}

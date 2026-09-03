import { Card, Grid, Stack } from "../../../theme/ui";
import ConsoleCenter from "./center";
import MixerPanel from "./mixer";
import SongStrip from "./song-strip";
import ToolsPanel from "./tools";

export default function KaraokeConsole({
  visible = true,
  song,
  currentTime,
  duration,
  isPlaying,
  audio,
  timeline,
  preferences,
  transport,
  onOpenAppSettings,
  onTogglePlay,
  onStop,
  onClose
}) {
  const {
    musicVolume,
    setMusicVolume,
    vocalVolume,
    setVocalVolume,
    melodyVolume,
    setMelodyVolume,
    previewPreference,
    keyShift,
    setKeyShift,
    showLyrics,
    setShowLyrics,
    showNotes,
    setShowNotes,
    autoHideConsole,
    setAutoHideConsole,
    effectPreset
  } = preferences;

  return (
    <Card
      as="aside"
      data-role="karaoke-console"
      aria-hidden={!visible}
      variant="laser"
      tilt={false}
      cardPanel={{
        style: {
          background:
            "linear-gradient(90deg, color-mix(in srgb, var(--color-bg-deep) 78%, transparent), color-mix(in srgb, var(--color-surface) 88%, transparent))",
          backdropFilter: "blur(var(--space-3)) saturate(1.25)"
        }
      }}
      cardContent={{ style: { padding: 0 } }}
      sx={{
        position: "absolute",
        inset: "auto var(--space-2) var(--space-2)",
        zIndex: 12,
        opacity: +visible,
        transform: visible ? "none" : "translateY(var(--space-8))",
        pointerEvents: visible ? "auto" : "none",
        transition:
          "opacity var(--motion-duration-normal) var(--motion-easing-standard), transform var(--motion-duration-normal) var(--motion-easing-spring)"
      }}
    >
      <Stack gap="var(--space-1)">
        <SongStrip {...{ song, currentTime, duration }} onSeek={transport.seekTo} />

        <Grid
          columns={3}
          gap="var(--space-3)"
          sx={{ padding: "var(--space-1) var(--space-3) var(--space-2)", alignItems: "center" }}
        >
          <MixerPanel
            microphoneLevel={audio.microphoneLevel}
            volumes={{
              microphone: audio.microphoneVolume,
              music: musicVolume,
              vocal: vocalVolume,
              melody: melodyVolume
            }}
            onVolumeChange={{
              microphone: audio.setMicrophoneVolume,
              music: (value) => previewPreference("musicVolume", value),
              vocal: (value) => previewPreference("vocalVolume", value),
              melody: (value) => previewPreference("melodyVolume", value)
            }}
            onVolumeCommit={{
              microphone: (value) => audio.updateMicrophone({ volume: value }),
              music: setMusicVolume,
              vocal: setVocalVolume,
              melody: setMelodyVolume
            }}
            microphoneEffects={audio.microphoneEffects}
            onEffectChange={audio.onEffectChange}
            onEffectCommit={audio.onEffectCommit}
            monitoringEnabled={audio.monitoringEnabled}
            onMonitoringChange={audio.onMonitoringChange}
          />

          <ConsoleCenter
            song={song}
            currentTempo={timeline.currentTempo}
            compactKey={timeline.compactKey}
            keyShift={keyShift}
            onTempoChange={timeline.changeTempo}
            onKeyShiftChange={setKeyShift}
            isPlaying={isPlaying}
            onSkip={transport.skip}
            onTogglePlay={onTogglePlay}
            onStop={onStop}
          />

          <ToolsPanel
            showNotes={showNotes}
            showLyrics={showLyrics}
            onToggleNotes={() => setShowNotes((value) => !value)}
            onToggleLyrics={() => setShowLyrics((value) => !value)}
            onOpenAppSettings={onOpenAppSettings}
            autoHideEnabled={autoHideConsole}
            onAutoHideChange={setAutoHideConsole}
            effectPreset={effectPreset}
            onApplyEffectPreset={audio.onApplyEffectPreset}
          />
        </Grid>
      </Stack>
    </Card>
  );
}

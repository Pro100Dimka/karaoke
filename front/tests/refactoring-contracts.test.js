import assert from "node:assert/strict";
import { multiSourceContract, sourceContract } from "./helpers/project.js";

const contracts = [
  ["Modal keeps stable lifecycle listeners", "src/components/Modal.jsx", [
    /const onCloseRef = useRef\(onClose\)/,
    /onCloseRef\.current = onClose/,
    /onCloseRef\.current\?\.\(\)/,
    /\}, \[isOpen\]\);/
  ], [/\}, \[isOpen, onClose\]\);/]],
  ["Dropdown listeners exist only while open", "src/components/fields/Dropdown.jsx", [
    /if \(!open\) return undefined/,
    /\}, \[open\]\);/,
    /if \(disabled\) setOpen\(false\)/
  ]],
  ["app settings ignores stale reload responses", "src/contexts/app-settings.jsx", [
    /const loadRequestRef = useRef\(0\)/,
    /requestId === loadRequestRef\.current/,
    /loadRequestRef\.current \+= 1/
  ]],
  ["Library uses centralized app settings", "src/pages/Library/index.jsx", [
    /useAppSettings/,
    /const \{ reloadSettings \} = useAppSettings\(\)/
  ], [/api\.getAppSettings\(\)/, /setAppSettings/]],
  ["polling queues refreshes and supports hidden documents", "src/hooks/usePolling.js", [
    /let refreshQueued = false/,
    /if \(inFlight\) \{\s*refreshQueued = true/,
    /const documentRef = globalThis\.document/,
    /documentRef\?\.addEventListener/,
    /documentRef\?\.removeEventListener/
  ]],
  ["settings writes share one queue", "src/hooks/useSettingsForm.js", [
    /mountedRef\.current = true/,
    /fieldRequestRef\.current\.clear\(\)/,
    /useAsyncQueue/,
    /const \{ run: queueSave \} = useAsyncQueue\(\)/,
    /const payload = form;/,
    /api\.updateAppSettings\(payload\)/
  ], [], [[/return queueSave\(async \(\) =>/g, 2]]],
  ["Karaoke follows route song changes", "src/pages/Karaoke/index.jsx", [
    /const songId = location\.state\?\.songId \|\| null;/
  ], [/useState\(location\.state\?\.songId/]],
  ["library delegates import, actions and room sync", "src/pages/Library/index.jsx", [
    /useLibraryFileImport\(/,
    /useLibrarySongActions\(/,
    /useLibraryRoomSync\(/
  ], [/window\.electronAPI\?\.openSongFolder/]],
  ["song folder errors are handled", "src/pages/Library/hooks/useLibrarySongActions.js", [
    /await window\.electronAPI\.openSongFolder/,
    /catch \(error\)/,
    /Не удалось открыть папку:/
  ]],
  ["remote library queries are event-driven", "src/pages/Library/hooks/useLibraryRoomSync.js", [
    /roomEventId/,
    /roomQueryRef\.current/,
    /queryRef\.current/,
    /applyingRemoteUiRef\.current = true/
  ]],
  ["online room modal guards duplicate joins", "src/components/OnlineRoomModal.jsx", [
    /import \{ Button, FieldInput \} from "\.\/fields"/,
    /connectionPendingRef = useRef\(false\)/,
    /if \(connectionPendingRef\.current\) return/,
    /const normalizedRoomId = normalizeRoomId\(roomId\)/,
    /room\.joinRoom\(normalizedRoomId, onlineName\)/
  ], [/<button\b/]],
  ["FieldInput forwards keyboard handlers", "src/components/fields/field-input.jsx", [
    /onKeyDown,/,
    /onKeyDown\n\s*\};/
  ]],
  ["mounted ref supports Strict Mode replay", "src/hooks/useMountedRef.js", [
    /mountedRef\.current = true/,
    /mountedRef\.current = false/
  ]],
  ["Electron backend restarts safely", "electron/main.cjs", [
    /function scheduleBackendRestart\(\)/,
    /backendStopRequested/,
    /const childProcess = spawn/,
    /if \(backendProcess === childProcess\) backendProcess = null/,
    /setPermissionCheckHandler/,
    /setPermissionRequestHandler/,
    /app\.on\("window-all-closed", \(\) => \{\s*if \(process\.platform === "darwin"\) return;/
  ]]
];

for (const [name, path, includes, excludes = [], count = []] of contracts) {
  sourceContract(name, path, { includes, excludes, count });
}

multiSourceContract(
  "feature components use shared controls",
  [
    "src/pages/Library/components/LibrarySongCard.jsx",
    "src/components/TitleBar.jsx",
    "src/components/ui/ErrorBoundary.jsx",
    "src/components/OnlineRoomDock.jsx",
    "src/components/OnlineRoomParticipant.jsx"
  ],
  (sources) => {
    for (const source of Object.values(sources)) assert.doesNotMatch(source, /<button\b/);
    assert.match(sources["src/components/TitleBar.jsx"], /<IconButton/);
    assert.match(sources["src/components/ui/ErrorBoundary.jsx"], /<Button/);
    assert.match(sources["src/components/OnlineRoomDock.jsx"], /<OnlineRoomParticipant/);
  }
);

const additionalContracts = [
  ["async guards share mounted state", "src/hooks/useAsyncQueue.js", [/useMountedRef/]],
  ["exclusive actions share mounted state", "src/hooks/useExclusiveAsyncAction.js", [/useMountedRef/]],
  ["audio settings serialize writes", "src/pages/Settings/audio-settings.jsx", [
    /useAsyncQueue/,
    /useExclusiveAsyncAction/,
    /enqueueAudioUpdate/,
    /runMonitoringToggle/,
    /let active = true/
  ]],
  ["Electron renderer uses sandbox isolation", "electron/main.cjs", [
    /contextIsolation:\s*true/,
    /nodeIntegration:\s*false/,
    /sandbox:\s*true/
  ]],
  ["renderer defines a restrictive CSP", "index.html", [
    /Content-Security-Policy/,
    /object-src 'none'/,
    /base-uri 'self'/,
    /frame-src https:\/\/www\.youtube\.com/
  ]],
  ["late room audio failures are connection-aware", "src/contexts/OnlineRoomContext.jsx", [
    /audio\.play\(\)\.catch\(\(\) => \{\s*if \(!isCurrentConnection\(\)\) return;/
  ]],
  ["room modal ignores late state updates", "src/components/OnlineRoomModal.jsx", [
    /const mountedRef = useMountedRef\(\)/,
    /if \(mountedRef\.current\) setBusy\(false\)/,
    /if \(mountedRef\.current\) \{\s*setError/
  ]],
  ["room copy timer is mount-aware", "src/components/OnlineRoomDock.jsx", [
    /globalThis\.setTimeout/,
    /globalThis\.clearTimeout/,
    /!mountedRef\.current/
  ]],
  ["microphone updates are serialized", "src/pages/Karaoke/hooks/useMicrophoneSettings.js", [
    /useAsyncQueue/,
    /enqueueUpdate\(async \(\) =>/,
    /Object\.hasOwn\(patch, "volume"\)/,
    /mountedRef\.current/
  ]],
  ["audio routing ignores stale enumeration", "src/pages/Karaoke/hooks/useAudioOutputRouting.js", [
    /let active = true/,
    /if \(!active\) return/,
    /active = false/,
    /context\.close\(\)\.catch/
  ]],
  ["performance deletion is mount-aware", "src/pages/Karaoke/components/PerformanceAnalysisModal.jsx", [
    /useExclusiveAsyncAction/,
    /<Modal/,
    /ariaLabel="Анализ выступления"/,
    /portal/,
    /const mountedRef = useMountedRef\(\)/,
    /if \(!mountedRef\.current\) return/,
    /if \(mountedRef\.current\) onDeleted\(\)/,
    /analysisRequestRef\.current\.recordingId !== recordingId/,
    /normalizeAnalysisResult/,
    /getAnalysisFeedback/,
    /<AudioPlayer/
  ]],
  ["Karaoke derives microphone level", "src/pages/Karaoke/index.jsx", [
    /const microphoneLevel = getMicrophoneLevel\(signal\);/,
    /microphoneLevel=\{microphoneLevel\}/,
    /<KaraokeMedia/,
    /<KaraokePerformanceStage/
  ], [/<audio\b/, /<MelodyRoll/, /<KaraokeLyricLine/]],
  ["Karaoke media owns media elements", "src/pages/Karaoke/components/KaraokeMedia.jsx", [
    /<audio\b/,
    /<iframe\b/,
    /<video\b/
  ]],
  ["Karaoke stage owns visual content", "src/pages/Karaoke/components/KaraokePerformanceStage.jsx", [
    /<MelodyRoll/,
    /<KaraokeLyricLine/
  ]],
  ["transport removes dead monitoring and rolls back playback", "src/pages/Karaoke/hooks/useKaraokeTransport.js", [
    /pausePlaybackResources\(\)/,
    /instrumentalRef\.current\?\.pause\(\)/,
    /vocalsRef\.current\?\.pause\(\)/,
    /videoRef\.current\?\.pause\(\)/,
    /sendYouTubeCommand\("pauseVideo"\)/,
    /silenceMelodyGuide\(\)/,
    /api\.pauseRecording\(activeRecordingId\)/,
    /operationId !== operationRef\.current/
  ], [/const setDirectMonitoring\s*=/, /manualMonitoringRef/, /AudioLines/]],
  ["song settings saves are exclusive", "src/pages/Library/song-settings/index.jsx", [/useExclusiveAsyncAction/]],
  ["room dock actions are exclusive", "src/components/OnlineRoomDock.jsx", [/useExclusiveAsyncAction/], [/document\.execCommand/]],
  ["title bar consumes rejected IPC promises", "src/components/TitleBar.jsx", [/Promise\.resolve\(electronAPI\[action\]\?\.\(\)\)\.catch/, /invokeWindowAction\(electronAPI, id\)/]]
];

for (const [name, path, includes, excludes = []] of additionalContracts) {
  sourceContract(name, path, { includes, excludes });
}

multiSourceContract(
  "Karaoke empty state and controls remain accessible",
  ["src/pages/Karaoke/index.jsx", "src/pages/Karaoke/components/PerformanceAnalysisModal.jsx", "src/components/AudioPlayer.jsx"],
  (sources) => {
    const emptyState = sources["src/pages/Karaoke/index.jsx"].match(/if \(!song\) \{([\s\S]*?)\n  \}\n  if \(song\.status/)?.[1];
    assert.ok(emptyState);
    assert.equal((emptyState.match(/<div\b/g) || []).length, 1);
    assert.equal((emptyState.match(/<\/div>/g) || []).length, 1);
    for (const label of ["Закрыть анализ", "Воспроизвести запись", "Выключить звук", "Включить звук"]) {
      assert.match(Object.values(sources).join("\n"), new RegExp(label));
    }
  }
);

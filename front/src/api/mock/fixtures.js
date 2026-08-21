export const MOCK_SONG_ID = "mock-song-1";

export const mockSongs = [
  {
    id: MOCK_SONG_ID,
    title: "Тестовая песня",
    artist: "A&D Voice",
    genre: "Pop",
    status: "done",
    progress_percent: 100,
    duration_sec: 185,
    key: "C",
    tempo: 120,
    video_url: ""
  },
  {
    id: "mock-song-processing",
    title: "Песня в обработке",
    artist: "Demo",
    status: "processing",
    progress_percent: 48,
    progress_step: "Разделение дорожек"
  }
];

export const mockKaraokeResult = {
  lyrics_sync: {
    bpm: 120,
    key: "C",
    text: "Добро пожаловать в A&D Voice\nИнтерфейс работает без backend",
    words: [
      { text: "Добро", start: 0, end: 1, notes: [{ note: 60, start: 0.5, end: 1 }] },
      { text: "пожаловать", start: 1, end: 2.4, notes: [{ note: 62, start: 1.3, end: 2.1 }] },
      { text: "в", start: 2.4, end: 2.7, notes: [] },
      { text: "A&D", start: 2.7, end: 3.8, notes: [{ note: 64, start: 2.7, end: 3.2 }] },
      { text: "Voice", start: 3.8, end: 5, notes: [{ note: 67, start: 3.8, end: 4.5 }] },
      { text: "Интерфейс", start: 5, end: 6.2, notes: [] },
      { text: "работает", start: 6.2, end: 7.5, notes: [] },
      { text: "без", start: 7.5, end: 8.2, notes: [] },
      { text: "backend", start: 8.2, end: 10, notes: [] }
    ]
  }
};

export const mockSongEditor = {
  ai_backup_exists: true,
  lyrics_sync: {
    bpm: 120,
    key: "C",
    duration: 10,
    words: [
      {
        text: "A&D",
        start: 0,
        end: 1.5,
        notes: [
          { note: 60, start: 0.5, end: 1 },
          { note: 64, start: 1, end: 1.5 }
        ]
      },
      { text: "Voice", start: 1.5, end: 2.5, notes: [] }
    ]
  }
};

export const mockAppSettings = {
  online_name: "Тестовый пользователь",
  theme: "dark",
  accent: "purple",
  density: "comfortable",
  animations: true
};

export const mockAudioSettings = {
  volume: 1,
  reverb: 0,
  echo: 0,
  delay: 0,
  noise_suppression: 0.35,
  audio_driver: "auto",
  asio_driver_name: "",
  buffer_size: 64,
  monitoring_enabled: false
};

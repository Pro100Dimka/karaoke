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
    text: "Добро пожаловать в A&D Voice\nИнтерфейс работает без backend",
    words: [
      { text: "Добро", start: 0, end: 1 },
      { text: "пожаловать", start: 1, end: 2.4 },
      { text: "в", start: 2.4, end: 2.7 },
      { text: "A&D", start: 2.7, end: 3.8 },
      { text: "Voice", start: 3.8, end: 5 },
      { text: "Интерфейс", start: 5, end: 6.2 },
      { text: "работает", start: 6.2, end: 7.5 },
      { text: "без", start: 7.5, end: 8.2 },
      { text: "backend", start: 8.2, end: 10 }
    ]
  },
  reference_notes: [
    { start: 0.5, end: 1.2, midi: 60 },
    { start: 1.3, end: 2.1, midi: 62 },
    { start: 2.2, end: 3.2, midi: 64 },
    { start: 3.3, end: 4.5, midi: 67 }
  ]
};

export const mockSongEditor = {
  ai_backup_exists: true,
  song_map: {
    duration: 10,
    syllables: [
      { index: 0, text: "A&D", word_index: 0 },
      { index: 1, text: "Voice", word_index: 1 }
    ],
    notes: [
      {
        _id: "mock-note-1",
        start: 0.5,
        end: 1.5,
        midi_note: 60,
        velocity: 96,
        syllable_index: 0,
        word_index: 0
      },
      {
        _id: "mock-note-2",
        start: 1.5,
        end: 2.5,
        midi_note: 64,
        velocity: 96,
        syllable_index: 1,
        word_index: 1
      }
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
  audio_driver: "auto",
  asio_driver_name: "",
  buffer_size: 64,
  monitoring_enabled: false
};

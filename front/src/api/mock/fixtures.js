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
  lyrics_sync: [
    {
      start: 0,
      end: 5,
      text: "Добро пожаловать в A&D Voice",
      words: [
        { text: "Добро", start: 0, end: 1 },
        { text: "пожаловать", start: 1, end: 2.4 },
        { text: "в", start: 2.4, end: 2.7 },
        { text: "Karaoke", start: 2.7, end: 3.8 },
        { text: "Studio", start: 3.8, end: 5 }
      ]
    },
    {
      start: 5,
      end: 10,
      text: "Интерфейс работает без backend",
      words: []
    }
  ],
  reference_notes: [
    { start: 0.5, end: 1.2, midi: 60 },
    { start: 1.3, end: 2.1, midi: 62 },
    { start: 2.2, end: 3.2, midi: 64 },
    { start: 3.3, end: 4.5, midi: 67 }
  ]
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

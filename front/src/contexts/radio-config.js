import { translateSaved } from "../i18n/runtime";

const streams = (id) => [
  `https://ice5.somafm.com/${id}-128-mp3`,
  `https://ice2.somafm.com/${id}-128-mp3`
];

const station = (id, name, group, description) => ({
  id,
  name: `SomaFM ${name}`,
  group: translateSaved(group),
  description: translateSaved(description),
  streams: streams(id)
});

// Five real SomaFM channels per broad genre group. Keeping every stream on
// the same redundant ice5/ice2 transport preserves the existing failover.
/* Stryker disable all */
export const RADIO_STATIONS = [
  station("poptron", "PopTron", "Поп и инди", "Электропоп и танцевальный инди-рок"),
  station("indiepop", "Indie Pop Rocks", "Поп и инди", "Новый и классический инди-поп"),
  station("lush", "Lush", "Поп и инди", "Мягкий женский вокал и электроника"),
  station("covers", "Covers", "Поп и инди", "Знакомые песни в необычных кавер-версиях"),
  station("insound", "The In-Sound", "Поп и инди", "Европейский поп шестидесятых и семидесятых"),

  station("seventies", "Left Coast 70s", "Рок и альтернатива", "Мягкий альбомный рок семидесятых"),
  station("metal", "Metal Detector", "Рок и альтернатива", "Метал от прога и трэша до пост-метала"),
  station("digitalis", "Digitalis", "Рок и альтернатива", "Экспериментальный электронный рок"),
  station("folkfwd", "Folk Forward", "Рок и альтернатива", "Инди-фолк и современная акустика"),
  station(
    "n5md",
    "n5MD Radio",
    "Рок и альтернатива",
    "Пост-рок и эмоциональная экспериментальная музыка"
  ),

  station(
    "beatblender",
    "Beat Blender",
    "Электроника и танцы",
    "Дип-хаус и спокойный электронный бит"
  ),
  station("thetrip", "The Trip", "Электроника и танцы", "Прогрессив-хаус и транс"),
  station("dubstep", "Dub Step Beyond", "Электроника и танцы", "Дабстеп, даб и глубокий бас"),
  station("cliqhop", "cliqhop idm", "Электроника и танцы", "IDM, ритмы и цифровые эксперименты"),
  station("vaporwaves", "Vaporwaves", "Электроника и танцы", "Круглосуточный vaporwave"),

  station("groovesalad", "Groove Salad", "Эмбиент и чилл", "Эмбиент, даунтемпо и мягкий грув"),
  station("groovesalad2", "Groove Salad 2", "Эмбиент и чилл", "Альтернативный микс чилл-эмбиента"),
  station(
    "gsclassic",
    "Groove Salad Classic",
    "Эмбиент и чилл",
    "Классический Groove Salad начала 2000-х"
  ),
  station("dronezone", "Drone Zone", "Эмбиент и чилл", "Атмосферные текстуры с минимумом ритма"),
  station("dz2", "Drone Zone 2", "Эмбиент и чилл", "Более эклектичный атмосферный эмбиент"),

  station("deepspaceone", "Deep Space One", "Космос и эксперимент", "Глубокий космический эмбиент"),
  station(
    "spacestation",
    "Space Station Soma",
    "Космос и эксперимент",
    "Космическая электроника среднего темпа"
  ),
  station(
    "synphaera",
    "Synphaera Radio",
    "Космос и эксперимент",
    "Современный электронный эмбиент"
  ),
  station(
    "missioncontrol",
    "Mission Control",
    "Космос и эксперимент",
    "Музыка и архивные голоса космических миссий"
  ),
  station("darkzone", "The Dark Zone", "Космос и эксперимент", "Тёмная сторона глубокого эмбиента"),

  station(
    "sonicuniverse",
    "Sonic Universe",
    "Джаз, соул и лаунж",
    "Современный и авангардный джаз"
  ),
  station(
    "7soul",
    "Seven Inch Soul",
    "Джаз, соул и лаунж",
    "Винтажный соул с оригинальных пластинок"
  ),
  station(
    "secretagent",
    "Secret Agent",
    "Джаз, соул и лаунж",
    "Стильный саундтрек для шпионского кино"
  ),
  station(
    "illstreet",
    "Illinois Street Lounge",
    "Джаз, соул и лаунж",
    "Классический лаунж и экзотика"
  ),
  station("bossa", "Bossa Beyond", "Джаз, соул и лаунж", "Босса-нова, самба и бразильские ритмы"),

  station(
    "suburbsofgoa",
    "Suburbs of Goa",
    "Мировая музыка и корни",
    "Азиатские и индийские world-биты"
  ),
  station(
    "thistle",
    "ThistleRadio",
    "Мировая музыка и корни",
    "Кельтская музыка от корней до современности"
  ),
  station("reggae", "Heavyweight Reggae", "Мировая музыка и корни", "Регги, ска и рокстеди"),
  station(
    "bootliquor",
    "Boot Liquor",
    "Мировая музыка и корни",
    "Американа и музыка кантри-корней"
  ),
  station("tikitime", "Tiki Time", "Мировая музыка и корни", "Винтажные островные и тики-ритмы"),

  station(
    "brfm",
    "Black Rock FM",
    "Эклектика и специальные",
    "Эклектичная музыка пустыни Black Rock"
  ),
  station("defcon", "DEF CON Radio", "Эклектика и специальные", "Музыка для хакерской культуры"),
  station("fluid", "Fluid", "Эклектика и специальные", "Инструментальный хип-хоп и future soul"),
  station(
    "chillits",
    "Chillits Radio",
    "Эклектика и специальные",
    "Живые чилл-сеты и фестивальная атмосфера"
  ),
  station(
    "specials",
    "Specials",
    "Эклектика и специальные",
    "Сезонные программы и специальные эфиры"
  )
];
/* Stryker restore all */

export const DEFAULT_RADIO_SETTINGS = Object.freeze({
  stationId: "poptron",
  volume: 0.1,
  enabled: true
});

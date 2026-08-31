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
  station("poptron", "PopTron", "radio.popAndIndie", "radio.electropopAndDanceableIndieRock"),
  station("indiepop", "Indie Pop Rocks", "radio.popAndIndie", "radio.newAndClassicIndiePop"),
  station("lush", "Lush", "radio.popAndIndie", "radio.softFemaleVocalsAndElectronica"),
  station("covers", "Covers", "radio.popAndIndie", "radio.familiarSongsInUnusualCoverVersions"),
  station(
    "insound",
    "The In-Sound",
    "radio.popAndIndie",
    "radio.europeanPopOfTheSixtiesAndSeventies"
  ),

  station(
    "seventies",
    "Left Coast 70s",
    "radio.rockAndAlternative",
    "radio.softAlbumRockOfTheSeventies"
  ),
  station(
    "metal",
    "Metal Detector",
    "radio.rockAndAlternative",
    "radio.metalFromProgAndThrashToPostMetal"
  ),
  station("digitalis", "Digitalis", "radio.rockAndAlternative", "radio.experimentalElectronicRock"),
  station(
    "folkfwd",
    "Folk Forward",
    "radio.rockAndAlternative",
    "radio.indieFolkAndContemporaryAcousticMusic"
  ),
  station(
    "n5md",
    "n5MD Radio",
    "radio.rockAndAlternative",
    "radio.postRockAndEmotionalExperimentalMusic"
  ),

  station(
    "beatblender",
    "Beat Blender",
    "radio.electronicAndDance",
    "radio.deepHouseAndMellowElectronicBeats"
  ),
  station("thetrip", "The Trip", "radio.electronicAndDance", "radio.progressiveHouseAndTrance"),
  station("dubstep", "Dub Step Beyond", "radio.electronicAndDance", "radio.dubstepDubAndDeepBass"),
  station(
    "cliqhop",
    "cliqhop idm",
    "radio.electronicAndDance",
    "radio.idmRhythmsAndDigitalExperiments"
  ),
  station("vaporwaves", "Vaporwaves", "radio.electronicAndDance", "radio.vaporwaveAroundTheClock"),

  station(
    "groovesalad",
    "Groove Salad",
    "radio.ambientAndChill",
    "radio.ambientDowntempoAndMellowGrooves"
  ),
  station(
    "groovesalad2",
    "Groove Salad 2",
    "radio.ambientAndChill",
    "radio.alternativeChillAmbientMix"
  ),
  station(
    "gsclassic",
    "Groove Salad Classic",
    "radio.ambientAndChill",
    "radio.classicGrooveSaladFromTheEarly2000s"
  ),
  station(
    "dronezone",
    "Drone Zone",
    "radio.ambientAndChill",
    "radio.atmosphericTexturesWithMinimalRhythm"
  ),
  station("dz2", "Drone Zone 2", "radio.ambientAndChill", "radio.moreEclecticAtmosphericAmbient"),

  station("deepspaceone", "Deep Space One", "radio.spaceAndExperimental", "radio.deepSpaceAmbient"),
  station(
    "spacestation",
    "Space Station Soma",
    "radio.spaceAndExperimental",
    "radio.midTempoSpaceElectronica"
  ),
  station(
    "synphaera",
    "Synphaera Radio",
    "radio.spaceAndExperimental",
    "radio.contemporaryElectronicAmbient"
  ),
  station(
    "missioncontrol",
    "Mission Control",
    "radio.spaceAndExperimental",
    "radio.musicAndArchiveVoicesFromSpaceMissions"
  ),
  station(
    "darkzone",
    "The Dark Zone",
    "radio.spaceAndExperimental",
    "radio.theDarkSideOfDeepAmbient"
  ),

  station(
    "sonicuniverse",
    "Sonic Universe",
    "radio.jazzSoulAndLounge",
    "radio.contemporaryAndAvantGardeJazz"
  ),
  station(
    "7soul",
    "Seven Inch Soul",
    "radio.jazzSoulAndLounge",
    "radio.vintageSoulFromOriginalRecords"
  ),
  station(
    "secretagent",
    "Secret Agent",
    "radio.jazzSoulAndLounge",
    "radio.stylishSpyMovieSoundtrack"
  ),
  station(
    "illstreet",
    "Illinois Street Lounge",
    "radio.jazzSoulAndLounge",
    "radio.classicLoungeAndExotica"
  ),
  station(
    "bossa",
    "Bossa Beyond",
    "radio.jazzSoulAndLounge",
    "radio.bossaNovaSambaAndBrazilianRhythms"
  ),

  station(
    "suburbsofgoa",
    "Suburbs of Goa",
    "radio.worldMusicAndRoots",
    "radio.asianAndIndianWorldBeats"
  ),
  station(
    "thistle",
    "ThistleRadio",
    "radio.worldMusicAndRoots",
    "radio.celticMusicFromRootsToToday"
  ),
  station(
    "reggae",
    "Heavyweight Reggae",
    "radio.worldMusicAndRoots",
    "radio.reggaeSkaAndRocksteady"
  ),
  station(
    "bootliquor",
    "Boot Liquor",
    "radio.worldMusicAndRoots",
    "radio.americanaAndCountryRootsMusic"
  ),
  station("tikitime", "Tiki Time", "radio.worldMusicAndRoots", "radio.vintageIslandAndTikiRhythms"),

  station(
    "brfm",
    "Black Rock FM",
    "radio.eclecticAndSpecial",
    "radio.eclecticMusicFromTheBlackRockDesert"
  ),
  station("defcon", "DEF CON Radio", "radio.eclecticAndSpecial", "radio.musicForHackerCulture"),
  station("fluid", "Fluid", "radio.eclecticAndSpecial", "radio.instrumentalHipHopAndFutureSoul"),
  station(
    "chillits",
    "Chillits Radio",
    "radio.eclecticAndSpecial",
    "radio.liveChillSetsAndFestivalAtmosphere"
  ),
  station(
    "specials",
    "Specials",
    "radio.eclecticAndSpecial",
    "radio.seasonalProgramsAndSpecialBroadcasts"
  )
];
/* Stryker restore all */

export const DEFAULT_RADIO_SETTINGS = Object.freeze({
  stationId: "poptron",
  volume: 0.1,
  enabled: true
});

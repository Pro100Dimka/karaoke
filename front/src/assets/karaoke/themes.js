import cosmicNebula from "./multi-nebulae-1.png";
import arboretum from "./themes/arboretum.webp";
import artistWorkshop from "./themes/artist_workshop.webp";
import belfastFarmhouse from "./themes/belfast_farmhouse.webp";
import brownPhotostudio02 from "./themes/brown_photostudio_02.webp";
import brownPhotostudio03 from "./themes/brown_photostudio_03.webp";
import capeHill from "./themes/cape_hill.webp";
import emptyWarehouse from "./themes/empty_warehouse_01.webp";
import eveningField from "./themes/evening_field.webp";
import farmField from "./themes/farm_field_puresky.webp";
import forestGrove from "./themes/forest_grove.webp";
import golfCourse from "./themes/golf_course_sunrise.webp";
import greenPointPark from "./themes/green_point_park.webp";
import hotelRoom from "./themes/hotel_room.webp";
import jeGray from "./themes/je_gray_02.webp";
import kiaraDawn from "./themes/kiara_1_dawn.webp";
import kloofendal from "./themes/kloofendal_48d_partly_cloudy.webp";
import lilienstein from "./themes/lilienstein.webp";
import lot from "./themes/lot_01.webp";
import metroNoord from "./themes/metro_noord.webp";
import natureReserve from "./themes/nature_reserve_forest.webp";
import oldHall from "./themes/old_hall.webp";
import snowField from "./themes/snow_field.webp";
import sunsetForest from "./themes/sunset_forest.webp";
import treetopBalcony from "./themes/treetop_balcony.webp";

// Each panorama is an equirectangular image, so it can move infinitely in
// either horizontal direction without exposing a seam.  The renderer supplies
// the same closed camera path to every theme.
export const KARAOKE_THEMES = [
  { id: "cosmic-nebula", image: cosmicNebula },
  { id: "arboretum", image: arboretum },
  { id: "artist-workshop", image: artistWorkshop },
  { id: "belfast-farmhouse", image: belfastFarmhouse },
  { id: "brown-photostudio-02", image: brownPhotostudio02 },
  { id: "brown-photostudio-03", image: brownPhotostudio03 },
  { id: "cape-hill", image: capeHill },
  { id: "empty-warehouse", image: emptyWarehouse },
  { id: "evening-field", image: eveningField },
  { id: "farm-field", image: farmField },
  { id: "forest-grove", image: forestGrove },
  { id: "golf-course", image: golfCourse },
  { id: "green-point-park", image: greenPointPark },
  { id: "hotel-room", image: hotelRoom },
  { id: "je-gray", image: jeGray },
  { id: "kiara-dawn", image: kiaraDawn },
  { id: "kloofendal", image: kloofendal },
  { id: "lilienstein", image: lilienstein },
  { id: "lot", image: lot },
  { id: "metro-noord", image: metroNoord },
  { id: "nature-reserve", image: natureReserve },
  { id: "old-hall", image: oldHall },
  { id: "snow-field", image: snowField },
  { id: "sunset-forest", image: sunsetForest },
  { id: "treetop-balcony", image: treetopBalcony },
];

export function shuffleThemes(themes = KARAOKE_THEMES) {
  const shuffled = [...themes];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

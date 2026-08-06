import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const layout = read("src/components/layout.jsx");
const routes = read("src/components/routes.jsx");
const library = read("src/pages/Library/index.jsx");
const songSettings = read("src/pages/Library/modals/song-settings/index.jsx");
const modal = read("src/components/modal/index.jsx");
const performanceModal = read(
  "src/pages/Karaoke/components/PerformanceAnalysisModal.jsx"
);

const forbiddenModalRoutes = ["/song-settings", "/analysis"];
for (const route of forbiddenModalRoutes) {
  test(`temporary modal route ${route} is not used as a route in layout`, () => {
    assert.equal(layout.includes(`pathname === "${route}"`), false);
    assert.equal(layout.includes(`navigate("${route}"`), false);
  });
  test(`temporary modal route ${route} is absent from app routes`, () => {
    assert.equal(routes.includes(route), false);
  });
  test(`temporary modal route ${route} is absent from Library navigation`, () => {
    assert.equal(library.includes(`navigate(\"${route}\"`), false);
  });
}

const layoutContracts = [
  "songSettingsId",
  "setSongSettingsId",
  "openSongSettings",
  "closeSongSettings",
  "onOpenSongSettings={openSongSettings}",
  "songId={songSettingsId}",
  "onClose={closeSongSettings}"
];
for (const contract of layoutContracts) {
  test(`layout keeps modal state contract: ${contract}`, () => {
    assert.equal(layout.includes(contract), true);
  });
}

const modalContracts = [
  'role="dialog"',
  'aria-modal="true"',
  'document.body.style.overflow = "hidden"',
  'document.addEventListener("keydown"',
  'document.removeEventListener("keydown"',
  "cancelAnimationFrame(frameId)",
  "previouslyFocused.focus()",
  'event.key === "Escape"',
  'event.key !== "Tab"'
];
for (const contract of modalContracts) {
  test(`shared Modal keeps behavior: ${contract}`, () => {
    assert.equal(modal.includes(contract), true);
  });
}

test("SongSettings receives songId as a prop instead of router state", () => {
  assert.match(songSettings, /function SongSettings\(\{ songId, onClose \}\)/);
  assert.equal(songSettings.includes("useLocation"), false);
});

test("Library opens song settings through a callback", () => {
  assert.equal(
    library.includes("onOpenSettings={() => onOpenSongSettings?.(song.id)}"),
    true
  );
});

test("Library opens analysis through local modal state", () => {
  assert.equal(library.includes("setAnalysisRecordingId(recording.id)"), true);
  assert.equal(library.includes("<PerformanceAnalysisModal"), true);
});

test("performance analysis uses the shared Modal", () => {
  assert.equal(performanceModal.includes("<Modal"), true);
  assert.equal(performanceModal.includes('role="dialog"'), false);
});

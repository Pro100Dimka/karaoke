import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { anchoredVerticalScrollToNote } from "../src/pages/Library/modals/song-settings/melody-editor-geometry.js";

const src = fs.readFileSync(new URL("../src/pages/Library/modals/song-settings/melody-editor.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");

test("V11 toolbar follows requested order and removes pitch buttons", () => {
  const top = src.slice(src.indexOf('className="melody-editor-action-groups"'), src.indexOf('<audio ref={vocalsRef}'));
  const tokens = [
    'label="Назад"', 'label={saving ? "Сохранение…" : "Сохранить"}', 'label="Отменить"',
    'label="Вернуть отменённое"', 'label="Вернуть результат AI"', 'Автопрокрутка',
    'label={playing ? "Стоп" : "Воспроизвести"}', 'label="Соединить выбранные"', 'label="Удалить выбранные"'
  ];
  let cursor = -1;
  for (const token of tokens) {
    const index = top.indexOf(token);
    assert.ok(index > cursor, token);
    cursor = index;
  }
  assert.doesNotMatch(src, /ChevronUp|ChevronDown|На полтона выше|На полтона ниже/);
  assert.doesNotMatch(src, /Plus|Добавить ноту/);
});

test("V11 layout places dials, SongStrip, then note text block", () => {
  const top = src.slice(src.indexOf('melody-editor-topdeck-v11'), src.indexOf('<audio ref={vocalsRef}'));
  const tools = top.indexOf('melody-editor-action-groups');
  const dials = top.indexOf('melody-editor-compact-dials');
  const strip = top.indexOf('<SongStrip');
  const selection = top.indexOf('melody-editor-inline-selection');
  assert.ok(tools < dials && dials < strip && strip < selection);
  assert.match(src, /\{song\?\.title \|\| "Песня"\} · VOCAL MELODY EDITOR/);
  assert.match(css, /\.melody-editor-tool-group/);
});

test("vertical zoom keeps the center note at the same screen y", () => {
  const args = { noteMidi:64, maxMidi:84, oldRowHeight:14, newRowHeight:28, scrollTop:180, clientHeight:600, rowCount:61 };
  const before = (args.maxMidi - args.noteMidi + 0.5) * args.oldRowHeight - args.scrollTop;
  const nextTop = anchoredVerticalScrollToNote(args);
  const after = (args.maxMidi - args.noteMidi + 0.5) * args.newRowHeight - nextTop;
  assert.equal(after, before);
});

test("playhead drag auditions short notes and does not start persistent synth", () => {
  const preview = src.slice(src.indexOf("const previewPlayhead"), src.indexOf("const startPlayheadDrag"));
  assert.match(preview, /auditionNote\(midi, 140\)/);
  assert.match(preview, /stopOscillator\(\)/);
  assert.doesNotMatch(preview, /updateSynth/);
  const seek = src.slice(src.indexOf("const seek = useCallback"), src.indexOf("const pointerTime"));
  assert.match(seek, /if \(running\) updateSynth\(value\)/);
  assert.match(seek, /else \{[\s\S]*auditionNote\(active\.midi_note, 180\)/);
});

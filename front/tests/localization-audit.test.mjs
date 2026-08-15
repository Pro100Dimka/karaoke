import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { violationsFor } from "../scripts/audit-localization.mjs";

const directories = [];
const inspect = (source) => {
  const directory = fs.mkdtempSync( path.join(os.tmpdir(), "localization-audit-")
  );
  directories.push(directory);
  const file = path.join(directory, "fixture.jsx");
  fs.writeFileSync(file, source);
  return violationsFor(file);
};

afterEach(() => {
  directories
    .splice(0)
    .forEach((directory) => fs.rmSync(directory, { force: true, recursive: true })
    );
});

describe("localization audit", () => {
  it("accepts direct, wrapped and exclusively translated messages", () => {
    expect(
      inspect(`
        const FALLBACK = "Ошибка";
        const formatError = (message, error) =>
          translateSaved(message, { 0: getErrorMessage(error, translateSaved(FALLBACK)) });
        translateSaved("Прямой перевод");
        formatError("Ошибка: {0}", error);
      `)
    ).toEqual([]);
  });

  it("rejects raw literals and translation helpers that leak their message", () => {
    expect(
      inspect(`
        const SHARED = "Сырая константа";
        const unsafe = (message) => [translateSaved(message), message];
        render(SHARED);
        translateSaved(SHARED);
        unsafe("Утечка");
        translateSaved("Ключ", { label: "Непереведённое значение" });
        const view = <div>Сырой JSX</div>;
        const template = \`Сырой шаблон\`;
      `)
    ).toEqual([2, 6, 7, 8, 9]);
  });
});

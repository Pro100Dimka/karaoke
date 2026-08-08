import assert from "node:assert/strict";
import test from "node:test";
import { listFiles, readSource, relativeToRoot } from "./helpers/project.js";
import {
  duplicateAttributes,
  importedAndDeclaredNames,
  openingTags
} from "./helpers/source-analysis.js";

const files = listFiles("src", { extensions: [".jsx"] });

for (const file of files) {
  const name = relativeToRoot(file);
  const source = readSource(name);
  const tags = openingTags(source);

  test(`${name} has no duplicate JSX attributes`, () => {
    assert.deepEqual(
      tags.flatMap((tag) =>
        duplicateAttributes(tag).map(
          (attr) => `${attr} in ${tag.slice(0, 120)}`
        )
      ),
      []
    );
  });

  test(`${name} resolves capitalized JSX identifiers`, () => {
    const known = importedAndDeclaredNames(source);
    const unresolved = [
      ...new Set(
        [...source.matchAll(/<([A-Z]\w*)\b/g)]
          .map((match) => match[1])
          .filter((name) => !known.has(name))
      )
    ];
    assert.deepEqual(unresolved, []);
  });
}

test("application JSX contains no duplicate type attributes", () => {
  assert.deepEqual(
    files
      .filter((file) =>
        openingTags(readSource(relativeToRoot(file))).some((tag) =>
          duplicateAttributes(tag).includes("type")
        )
      )
      .map(relativeToRoot),
    []
  );
});

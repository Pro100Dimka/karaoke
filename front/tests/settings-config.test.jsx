import { describe, expect, test } from "vitest";
import { FIELDS, SERVICES, TABS } from "../src/pages/Settings/schema.js";

describe("new settings schema", () => {
  test("describes every tab and service from compact data", () => {
    expect(TABS.map(([id]) => id)).toEqual(["appearance", "audio", "ai"]);
    expect(SERVICES).toEqual(["memory", "history", "diagnostics", "about"]);
    expect(Object.keys(FIELDS)).toEqual(TABS.map(([id]) => id));
  });

  test("keeps every field addressable and source-bound", () => {
    Object.values(FIELDS)
      .flat()
      .forEach((field) => {
        expect(["app", "audio", "radio"]).toContain(field.source);
        expect(field.name).toBeTruthy();
        expect(field.label).toBeTruthy();
      });
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { copyText } from "../src/utils/clipboard.js";

function withGlobals(values, run) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value
    });
  }

  return Promise.resolve(run()).finally(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
}

test("copyText prefers the Electron bridge", async () => {
  let copiedValue = null;
  await withGlobals(
    {
      window: {
        electronAPI: {
          copyText: async (value) => {
            copiedValue = value;
            return true;
          }
        }
      },
      navigator: {}
    },
    async () => {
      assert.equal(await copyText(1234), true);
      assert.equal(copiedValue, "1234");
    }
  );
});

test("copyText falls back when the Electron bridge rejects", async () => {
  let browserValue = null;
  await withGlobals(
    {
      window: {
        electronAPI: {
          copyText: async () => {
            throw new Error("bridge unavailable");
          }
        }
      },
      navigator: {
        clipboard: {
          writeText: async (value) => {
            browserValue = value;
          }
        }
      }
    },
    async () => {
      assert.equal(await copyText("ROOM"), true);
      assert.equal(browserValue, "ROOM");
    }
  );
});

test("copyText rejects empty values without touching platform APIs", async () => {
  await withGlobals(
    {
      window: {
        electronAPI: {
          copyText: async () => {
            throw new Error("must not be called");
          }
        }
      },
      navigator: {}
    },
    async () => {
      assert.equal(await copyText(""), false);
      assert.equal(await copyText(null), false);
    }
  );
});

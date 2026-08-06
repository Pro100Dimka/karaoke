/* eslint-disable import/extensions */
import assert from "node:assert/strict";
import test from "node:test";
import { request, requestBlob } from "../src/api/core.js";

function response({
  ok = true,
  status = 200,
  statusText = "",
  json,
  text = "",
  blob = new Blob(["blob"]),
  url = "http://api/test"
}) {
  return {
    ok,
    status,
    statusText,
    url,
    async json() {
      if (json instanceof Error) throw json;
      return json;
    },
    async text() {
      return text;
    },
    async blob() {
      return blob;
    }
  };
}

async function withFetch(mock, callback) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await callback();
  } finally {
    globalThis.fetch = previous;
  }
}

test("request parses JSON responses", async () => {
  await withFetch(
    async () => response({ text: '{"ok":true}' }),
    async () => {
      assert.deepEqual(await request("/test"), { ok: true });
    }
  );
});

test("request returns null for empty and 204 responses", async () => {
  await withFetch(
    async () => response({ text: "" }),
    async () => {
      assert.equal(await request("/empty"), null);
    }
  );
  await withFetch(
    async () => response({ status: 204, text: "ignored" }),
    async () => {
      assert.equal(await request("/empty"), null);
    }
  );
});

test("request reports malformed successful JSON with endpoint context", async () => {
  await withFetch(
    async () => response({ text: "{", url: "http://api/broken" }),
    async () => {
      await assert.rejects(request("/broken"), /Некорректный JSON.*broken/);
    }
  );
});

test("request reads backend detail strings", async () => {
  await withFetch(
    async () =>
      response({ ok: false, status: 400, json: { detail: "Ошибка данных" } }),
    async () => {
      await assert.rejects(request("/bad"), /Ошибка данных/);
    }
  );
});

test("request serializes structured backend errors", async () => {
  await withFetch(
    async () =>
      response({
        ok: false,
        status: 422,
        json: { detail: { field: "title" } }
      }),
    async () => {
      await assert.rejects(request("/bad"), /field.*title/);
    }
  );
});

test("request falls back to statusText when error body is not JSON", async () => {
  await withFetch(
    async () =>
      response({
        ok: false,
        status: 500,
        statusText: "Server Error",
        json: new Error("bad")
      }),
    async () => {
      await assert.rejects(request("/bad"), /Server Error/);
    }
  );
});

test("request sets JSON content type for string bodies", async () => {
  let init;
  await withFetch(
    async (_url, options) => {
      init = options;
      return response({ text: "{}" });
    },
    async () => {
      await request("/settings", {
        method: "PATCH",
        body: JSON.stringify({ a: 1 })
      });
    }
  );
  assert.equal(init.headers["Content-Type"], "application/json");
});

test("request preserves caller headers", async () => {
  let init;
  await withFetch(
    async (_url, options) => {
      init = options;
      return response({ text: "{}" });
    },
    async () => {
      await request("/settings", {
        body: "{}",
        headers: { Authorization: "Bearer mock" }
      });
    }
  );
  assert.equal(init.headers.Authorization, "Bearer mock");
});

test("request does not force JSON headers for FormData", async () => {
  let init;
  await withFetch(
    async (_url, options) => {
      init = options;
      return response({ text: "{}" });
    },
    async () => {
      await request("/upload", { method: "POST", body: new FormData() });
    }
  );
  assert.equal(init.headers, undefined);
});

test("request propagates network failures", async () => {
  await withFetch(
    async () => {
      throw new TypeError("network down");
    },
    async () => {
      await assert.rejects(request("/test"), /network down/);
    }
  );
});

test("requestBlob uses the shared backend error parser", async () => {
  await withFetch(
    async () =>
      response({ ok: false, status: 409, json: { detail: "Пакет не готов" } }),
    async () => {
      await assert.rejects(requestBlob("/songs/1/package"), /Пакет не готов/);
    }
  );
});

test("requestBlob returns the response payload", async () => {
  const payload = new Blob(["karaoke"], { type: "application/zip" });
  await withFetch(
    async () => response({ blob: payload }),
    async () => {
      assert.equal(await requestBlob("/songs/1/package"), payload);
    }
  );
});

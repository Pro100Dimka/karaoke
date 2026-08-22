import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createGraph: vi.fn()
}));

vi.mock("../src/services/microphoneStudioQuality.js", () => ({
  createStudioMicrophoneGraph: mocks.createGraph
}));

describe("central microphone capture", () => {
  let getUserMedia;
  let graph;

  beforeEach(() => {
    vi.resetModules();
    const processedStream = {
      getAudioTracks: () => [{ readyState: "live" }]
    };
    const rawStream = { id: "raw" };
    graph = {
      stream: processedStream,
      rawStream,
      getStream: vi.fn(({ disabledEffects = false } = {}) => (disabledEffects ? rawStream : processedStream)),
      close: vi.fn().mockResolvedValue(undefined),
      replaceInput: vi.fn().mockResolvedValue(undefined),
      setNoiseSuppression: vi.fn()
    };
    mocks.createGraph.mockReset().mockReturnValue(graph);
    getUserMedia = vi.fn().mockResolvedValueOnce({ id: "default" }).mockResolvedValueOnce({ id: "studio" });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { mediaDevices: { getUserMedia } }
    });
  });

  afterEach(() => vi.restoreAllMocks());

  test("shares one processed stream and closes it after the final lease", async () => {
    const { acquireMicrophone } = await import("../src/services/microphoneCapture.js");
    const first = await acquireMicrophone();
    const second = await acquireMicrophone();

    expect(first.stream).toBe(second.stream);
    expect(getUserMedia).toHaveBeenCalledOnce();
    await first.release();
    expect(graph.close).not.toHaveBeenCalled();
    await second.release();
    expect(graph.close).toHaveBeenCalledOnce();
  });

  test("can bypass effects for one lease without changing other microphone users", async () => {
    const { acquireMicrophone } = await import("../src/services/microphoneCapture.js");
    const clean = await acquireMicrophone("", { disabledEffects: true });
    const processed = await acquireMicrophone();

    expect(clean.stream).toBe(graph.rawStream);
    expect(processed.stream).toBe(graph.stream);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(graph.getStream).toHaveBeenNthCalledWith(1, { disabledEffects: true });
    expect(graph.getStream).toHaveBeenNthCalledWith(2, { disabledEffects: false });
    await clean.release();
    await processed.release();
  });

  test("switches the physical input without replacing the shared output stream", async () => {
    const { acquireMicrophone } = await import("../src/services/microphoneCapture.js");
    const defaultLease = await acquireMicrophone();
    const selectedLease = await acquireMicrophone("studio-mic");

    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: "studio-mic" } })
    });
    expect(graph.replaceInput).toHaveBeenCalledWith({ id: "studio" });
    expect(selectedLease.stream).toBe(defaultLease.stream);
    await defaultLease.release();
    await selectedLease.release();
  });

  test("falls back to the default input when the selected device disappeared", async () => {
    getUserMedia = vi.fn().mockRejectedValueOnce(new Error("missing device")).mockResolvedValueOnce({ id: "fallback" });
    navigator.mediaDevices.getUserMedia = getUserMedia;
    const { acquireMicrophone } = await import("../src/services/microphoneCapture.js");
    const lease = await acquireMicrophone("missing");

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(mocks.createGraph).toHaveBeenCalledWith({ id: "fallback" });
    await lease.release();
  });
});

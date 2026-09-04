import { afterEach, describe, expect, test, vi } from "vitest";


const loadProtocol = () => import("../src/services/onlineVoiceTransferProtocol.js");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("online transfer protocol", () => {
  test("sends a status only through an open writable channel", async () => {
    const { sendTransferStatus } = await loadProtocol();
    const open = { readyState: "open", send: vi.fn() };
    const closed = { readyState: "closed", send: vi.fn() };
    const broken = {
      readyState: "open",
      send: vi.fn(() => {
        throw new Error("closed");
      })
    };

    expect(sendTransferStatus(open, { type: "file-ready", transferId: "one" })).toBe(true);
    expect(open.send).toHaveBeenCalledWith('{"type":"file-ready","transferId":"one"}');
    expect(sendTransferStatus(closed, {})).toBe(false);
    expect(closed.send).not.toHaveBeenCalled();
    expect(sendTransferStatus(broken, {})).toBe(false);
  });

  test("resolves and detaches a completed abortable delay", async () => {
    vi.useFakeTimers();
    const { waitAbortable } = await loadProtocol();
    const signal = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
    const pending = waitAbortable(25, signal);

    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toBeUndefined();
    expect(signal.addEventListener).toHaveBeenCalledWith("abort", expect.any(Function), {
      once: true
    });
    expect(signal.removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  test("rejects an already aborted delay and an abort received while waiting", async () => {
    vi.useFakeTimers();
    const { waitAbortable } = await loadProtocol();
    await expect(waitAbortable(25, { aborted: true })).rejects.toThrow("Передача файла отменена");

    let abort;
    const signal = {
      aborted: false,
      addEventListener: vi.fn((_type, listener) => {
        abort = listener;
      }),
      removeEventListener: vi.fn()
    };
    const pending = waitAbortable(25, signal);
    abort();
    await expect(pending).rejects.toThrow("Передача файла отменена");
    expect(signal.removeEventListener).toHaveBeenCalledWith("abort", abort);
    await vi.advanceTimersByTimeAsync(25);
  });

  test("cancels every pending stage and flow waiter owned by a transfer", async () => {
    const { cancelOutboundTransferById } = await loadProtocol();
    const error = new Error("cancelled");
    const pending = (reject) => ({ timer: setTimeout(() => {}, 60_000), reject });
    const admissionReject = vi.fn();
    const confirmationReject = vi.fn();
    const flowReject = vi.fn();
    const mesh = {
      pendingTransferAdmissions: new Map([["one", pending(admissionReject)]]),
      pendingTransferConfirmations: new Map([["one", pending(confirmationReject)]]),
      pendingTransferCredits: new Map([["one", { waiters: [{ timer: setTimeout(() => {}, 60_000), reject: flowReject }] }]])
    };

    cancelOutboundTransferById(mesh, "one", error);
    expect(admissionReject).toHaveBeenCalledWith(error);
    expect(confirmationReject).toHaveBeenCalledWith(error);
    expect(flowReject).toHaveBeenCalledWith(error);
    expect(mesh.pendingTransferAdmissions.has("one")).toBe(false);
    expect(mesh.pendingTransferConfirmations.has("one")).toBe(false);
    expect(mesh.pendingTransferCredits.has("one")).toBe(false);

    cancelOutboundTransferById(mesh, "missing", error);
  });
});

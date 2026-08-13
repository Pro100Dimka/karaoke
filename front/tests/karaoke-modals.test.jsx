/* @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runAnalysis: vi.fn(),
  deleteRecording: vi.fn(),
  confirm: vi.fn()
}));
vi.mock("../src/api/client", () => ({
  api: {
    runAnalysis: mocks.runAnalysis,
    deleteRecording: mocks.deleteRecording,
    getPerformanceFileUrl: (id) => `performance/${id}`
  }
}));
vi.mock("../src/contexts/AppDialog", () => ({
  useAppDialog: () => ({ confirm: mocks.confirm })
}));
vi.mock("../src/components/modal", () => ({
  default: ({ children, titleProps }) => (
    <section>
      <h1>{titleProps?.title}</h1>
      {titleProps?.actions}
      {children}
    </section>
  )
}));
vi.mock("../src/components/AudioPlayer", () => ({
  AudioPlayer: ({ src }) => <audio data-testid="audio" src={src} />
}));
vi.mock("../src/components/fields", () => ({
  Button: ({ children, icon: _icon, ...props }) => (
    <button {...props}>{children}</button>
  )
}));
vi.mock("../src/components/fields/button", () => ({
  default: ({ children, icon: _icon, unstyled: _unstyled, ...props }) => (
    <button {...props}>{children}</button>
  )
}));
import PerformanceAnalysisModal from "../src/pages/Karaoke/modals/performance-analysis-modal.jsx";

beforeEach(() => {
  mocks.runAnalysis.mockReset();
  mocks.deleteRecording.mockReset().mockResolvedValue(undefined);
  mocks.confirm.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);

test("analysis modal renders normalized result and deletes recording", async () => {
  mocks.runAnalysis.mockResolvedValue({
    accuracy_percent: 88,
    mean_deviation_semitones: 0.4,
    scored_sections: [{ accuracy_percent: 90 }, { accuracy_percent: 60 }]
  });
  const done = vi.fn();
  const deleted = vi.fn();
  const result = render(
    <PerformanceAnalysisModal
      recordingId="rec"
      onClose={vi.fn()}
      onDone={done}
      onDeleted={deleted}
    />
  );
  expect(result.container.textContent).toMatch(/Аналізуємо|Анализируем/);
  await waitFor(() => expect(result.getByTestId("audio")).not.toBeNull());
  expect(
    result.container.querySelectorAll(".analysis-confetti i")
  ).toHaveLength(26);
  fireEvent.click(result.container.querySelector(".modal-title-action"));
  expect(done).toHaveBeenCalled();
  fireEvent.click(
    result.container.querySelector(".performance-analysis-actions button")
  );
  await waitFor(() =>
    expect(mocks.deleteRecording).toHaveBeenCalledWith("rec")
  );
  expect(deleted).toHaveBeenCalled();
});

test("analysis modal reports analysis and deletion failures", async () => {
  const close = vi.fn();
  mocks.runAnalysis.mockRejectedValueOnce(new Error("analysis failed"));
  const result = render(
    <PerformanceAnalysisModal recordingId="bad" onClose={close} />
  );
  await waitFor(() =>
    expect(
      result.container.querySelector(".song-lyrics-error").textContent
    ).toContain("analysis failed")
  );
  fireEvent.click(result.container.querySelector(".modal-title-action"));
  expect(close).toHaveBeenCalled();
  cleanup();

  mocks.runAnalysis.mockResolvedValueOnce({ accuracy_percent: 50 });
  mocks.deleteRecording.mockRejectedValueOnce(new Error("delete failed"));
  const deletion = render(
    <PerformanceAnalysisModal recordingId="rec" onClose={vi.fn()} />
  );
  await waitFor(() => expect(deletion.getByTestId("audio")).not.toBeNull());
  fireEvent.click(
    deletion.container.querySelector(".performance-analysis-actions button")
  );
  await waitFor(() =>
    expect(
      deletion.container.querySelector(".song-lyrics-error").textContent
    ).toContain("delete failed")
  );
});

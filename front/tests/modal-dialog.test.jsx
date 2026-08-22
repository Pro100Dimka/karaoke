/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { stubFrameQueue, stubImmediateAnimationFrame, suppressWindowErrors } from "./helpers/browser.mjs";
import { Modal } from "../src/theme/ui";
import { AppDialogProvider, resolveDialog, useAppDialog } from "../src/contexts/AppDialog";
import { same, verify } from "./helpers/assertions.mjs";
vi.mock("../src/i18n", async (importOriginal) => ({
  ...(await importOriginal()),
  useI18n: () => ({ t: (key) => key })
}));
const Icon = (props) => <svg data-testid="title-icon" {...props} />;
beforeEach(() => {
  stubImmediateAnimationFrame();
  document.body.style.overflow = "auto";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.body.style.overflow = "";
});
describe("modal", () => {
  test("renders nothing while closed", () => {
    const { container } = render(<Modal isOpen={false}>Hidden</Modal>);
    same([container.textContent, ""], [document.body.style.overflow, "auto"]);
  });
  test("renders title options, locks scrolling and closes from every control", () => {
    const close = vi.fn();
    const previous = document.createElement("button");
    document.body.append(previous);
    previous.focus();
    const { unmount } = render(
      <Modal
        isOpen
        onClose={close}
        ariaLabel="Settings dialog"
        closeAriaLabel="Dismiss"
        backdropClassName="custom custom"
        modalClassName="dialog-extra"
        closeClassName="close-extra"
        maxWidth="30rem"
        titleProps={{
          icon: Icon,
          eyebrow: "Section",
          title: "Settings",
          description: "Description",
          actions: <button>Action</button>
        }}
      >
        <button>First</button>
        <button>Last</button>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    same([document.body.style.overflow, "hidden"], [dialog.style.maxInlineSize, "30rem"]);
    verify(
      [document.querySelectorAll(".custom"), "toHaveLength", 1],
      [screen.getByTestId("title-icon"), "not.toBeNull"],
      [screen.getByText("Description"), "not.toBeNull"]
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByLabelText("Dismiss"));
    const backdrop = document.querySelector(".ui-modal-backdrop");
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseDown(dialog);
    expect(close).toHaveBeenCalledTimes(3);
    unmount();
    same([document.body.style.overflow, "auto"], [document.activeElement, previous]);
  });
  test("traps focus and only lets the top modal handle Escape", () => {
    const bottomClose = vi.fn();
    const topClose = vi.fn();
    render(
      <>
        <Modal isOpen onClose={bottomClose} ariaLabel="Bottom">
          <button>Bottom button</button>
        </Modal>
        <Modal isOpen onClose={topClose} ariaLabel="Top" portal>
          <button>Top first</button>
          <button>Top last</button>
        </Modal>
      </>
    );
    const first = screen.getByText("Top first");
    const topDialog = screen.getByRole("dialog", { name: "Top" });
    const last = topDialog.querySelector(".ui-modal-close");
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    fireEvent.keyDown(document, { key: "A" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(topClose).toHaveBeenCalledOnce();
    expect(bottomClose).not.toHaveBeenCalled();
  });
  test("does not move focus from a modal covered before its animation frame", () => {
    const frames = stubFrameQueue();
    render(
      <>
        <Modal isOpen ariaLabel="Bottom delayed" />
        <Modal isOpen ariaLabel="Top delayed" />
      </>
    );
    act(() => frames.forEach((callback) => callback()));
    verify([screen.getByRole("dialog", { name: "Top delayed" }).contains(document.activeElement), "toBe", true]);
  });
  test("keeps focus in a dialog without controls", () => {
    render(
      <Modal isOpen ariaLabel="Empty">
        {" "}
        Content{" "}
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    dialog.querySelector(".ui-modal-close").remove();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(dialog);
  });
});
function DialogDriver({ run, onValue }) {
  const dialog = useAppDialog();
  useEffect(() => {
    run(dialog).then(onValue);
  }, [dialog, onValue, run]);
  return null;
}
describe("application dialog provider", () => {
  test("resolves optional dialog handles safely", () => {
    const resolve = vi.fn();
    expect(() => resolveDialog(null, true)).not.toThrow();
    resolveDialog({ resolve }, false);
    expect(resolve).toHaveBeenCalledWith(false);
  });
  test("resolves alert confirmation", async () => {
    const onValue = vi.fn();
    const run = vi.fn(({ alert }) => alert("Saved", { title: "Notice", confirmClassName: "" }));
    render(
      <AppDialogProvider>
        {" "}
        <DialogDriver run={run} onValue={onValue} />{" "}
      </AppDialogProvider>
    );
    expect(screen.getByText("Saved")).not.toBeNull();
    const closeButton = document.querySelector(".ui-modal-title-actions button");
    verify([closeButton, "not.toBeNull"], [screen.queryByText("Отмена"), "toBeNull"]);
    act(() => {
      closeButton.click();
      closeButton.click();
    });
    await act(async () => Promise.resolve());
    expect(onValue).toHaveBeenCalledWith(true);
  });
  test("requires the application dialog provider", () => {
    const { log, restore } = suppressWindowErrors();
    verify([() => renderHook(() => useAppDialog()), "toThrow", "useAppDialog повинен використовуватися всередині AppDialogProvider"]);
    restore();
  });
  test("resolves confirmation cancellation and replacement", async () => {
    let controls;
    const values = [];
    function Consumer() {
      controls = useAppDialog();
      return null;
    }
    render(
      <AppDialogProvider>
        {" "}
        <Consumer />{" "}
      </AppDialogProvider>
    );
    await act(async () => {
      controls.confirm("First", "Custom title").then((value) => values.push(value));
    });
    await act(async () => {
      controls.alert("Replacement").then((value) => values.push(value));
    });
    expect(values).toEqual([false]);
    fireEvent.mouseDown(document.querySelector(".ui-modal-backdrop"));
    await act(async () => Promise.resolve());
    expect(values).toEqual([false, true]);
    await act(async () => {
      controls.confirm("Cancel me").then((value) => values.push(value));
    });
    fireEvent.click(document.querySelector('[data-role="dialog-cancel"]'));
    await act(async () => Promise.resolve());
    expect(values.at(-1)).toBe(false);
  });
  test("resolves an active dialog when its provider unmounts", async () => {
    let controls;
    const value = vi.fn();
    function Consumer() {
      controls = useAppDialog();
      return null;
    }
    const view = render(
      <AppDialogProvider>
        {" "}
        <Consumer />{" "}
      </AppDialogProvider>
    );
    act(() => {
      controls.confirm("Pending").then(value);
    });
    view.unmount();
    await act(async () => Promise.resolve());
    expect(value).toHaveBeenCalledWith(false);
  });
});

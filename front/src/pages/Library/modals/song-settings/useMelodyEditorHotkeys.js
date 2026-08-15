import { useEffect } from "react";
import {
  isEditableHotkeyTarget,
  isHotkeyScopeActive
} from "../../../../utils/hotkeys";

const DELETE_KEYS = ["Delete", "Backspace"];
const HORIZONTAL_ARROW_KEYS = ["ArrowLeft", "ArrowRight"];

const MODIFIER_ACTIONS = {
  KeyY: ({ redo }) => redo,
  KeyS: ({ saveRef }) => () => saveRef.current?.(),
  KeyA: ({ editable, selectAll }) => (editable ? null : selectAll),
  KeyC: ({ editable, copySelected }) => (editable ? null : copySelected),
  KeyX: ({ editable, copySelected, deleteSelected }) =>
    editable
      ? null
      : () => {
          copySelected();
          deleteSelected();
        },
  KeyV: ({ editable, pasteNotes }) => (editable ? null : pasteNotes),
  KeyD: ({ editable, duplicateSelected }) =>
    editable ? null : duplicateSelected
};

function getModifierAction(code, context) {
  if (code === "KeyZ") return context.shiftKey ? context.redo : context.undo;
  return Object.hasOwn(MODIFIER_ACTIONS, code)
    ? MODIFIER_ACTIONS[code](context)
    : null;
}

export default function useMelodyEditorHotkeys({
  clearSelection,
  copySelected,
  deleteSelected,
  duplicateSelected,
  duration,
  nudgeSelected,
  pasteNotes,
  pause,
  play,
  playing,
  redo,
  saveRef,
  seek,
  selectAdjacentNote,
  selectAll,
  selectedCount,
  undo,
  workspaceRef
}) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        !isHotkeyScopeActive(workspaceRef.current)
      )
        return;

      const editable = isEditableHotkeyTarget(event.target);
      const mod = event.ctrlKey || event.metaKey;
      const { code, key } = event;
      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      };
      const run = (action) => {
        consume();
        action();
      };

      if (mod) {
        const modifierAction = getModifierAction(code, {
          editable,
          shiftKey: event.shiftKey,
          redo,
          undo,
          saveRef,
          selectAll,
          copySelected,
          deleteSelected,
          pasteNotes,
          duplicateSelected
        });
        if (modifierAction) {
          run(modifierAction);
          return;
        }
      }
      if (editable) return;
      if (code === "Space") {
        run(playing ? pause : play);
        return;
      }
      if (DELETE_KEYS.includes(key)) {
        run(deleteSelected);
        return;
      }
      if (key === "Escape") {
        if (selectedCount) run(clearSelection);
        return;
      }
      if (key === "Home") {
        run(() => seek(0));
        return;
      }
      if (key === "End") {
        run(() => seek(duration));
        return;
      }
      if (HORIZONTAL_ARROW_KEYS.includes(key)) {
        const direction = key === "ArrowRight" ? 1 : -1;
        run(() => {
          if (mod)
            nudgeSelected(direction * (event.shiftKey ? 0.25 : 0.05), 0);
          else selectAdjacentNote(direction);
        });
        return;
      }
      if (!selectedCount) return;
      if (key === "ArrowUp") {
        run(() => nudgeSelected(0, event.shiftKey ? 12 : 1));
        return;
      }
      if (key === "ArrowDown") run(() => nudgeSelected(0, event.shiftKey ? -12 : -1));
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    clearSelection,
    copySelected,
    deleteSelected,
    duplicateSelected,
    duration,
    nudgeSelected,
    pasteNotes,
    pause,
    play,
    playing,
    redo,
    saveRef,
    seek,
    selectAdjacentNote,
    selectAll,
    selectedCount,
    undo,
    workspaceRef
  ]);
}

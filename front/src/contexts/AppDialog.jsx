import { AlertTriangle, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { FOCUSABLE_SELECTOR } from "../components/modal-focus";
import {
  createDialogConfig,
  getDialogCloseResult,
  normalizeDialogOptions
} from "./dialog-utils";

const DialogContext = createContext(null);

function DialogIcon({ kind }) {
  if (kind === "confirm") {
    return <AlertTriangle size={22} aria-hidden="true" />;
  }

  return <Info size={22} aria-hidden="true" />;
}

function DialogModal({ dialog, onClose }) {
  const dialogRef = useRef(null);
  const cancelButtonRef = useRef(null);
  const primaryButtonRef = useRef(null);

  const isConfirmation = dialog.kind === "confirm";
  const closeResult = getDialogCloseResult(dialog.kind);

  useEffect(() => {
    const previouslyFocused = document.activeElement;

    const animationFrameId = requestAnimationFrame(() => {
      const initialFocusTarget = isConfirmation
        ? cancelButtonRef.current
        : primaryButtonRef.current;

      initialFocusTarget?.focus();
    });

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(closeResult);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) ?? []
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      const { activeElement } = document;

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelAnimationFrame(animationFrameId);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;

      if (
        previouslyFocused instanceof HTMLElement &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [closeResult, isConfirmation, onClose]);

  const handleBackdropMouseDown = (event) => {
    if (event.target === event.currentTarget) {
      onClose(closeResult);
    }
  };

  return createPortal(
    <div
      className="app-dialog-backdrop"
      role="presentation"
      onMouseDown={handleBackdropMouseDown}
    >
      <section
        ref={dialogRef}
        className="app-dialog"
        role={isConfirmation ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby="app-dialog-message"
        tabIndex={-1}
      >
        <button
          type="button"
          className="app-dialog-close"
          aria-label="Закрыть"
          onClick={() => onClose(closeResult)}
        >
          <X size={18} aria-hidden="true" />
        </button>

        <div className="app-dialog-icon">
          <DialogIcon kind={dialog.kind} />
        </div>

        <span className="app-dialog-label">{dialog.label}</span>

        <h2 id="app-dialog-title">{dialog.title}</h2>

        <p id="app-dialog-message">{dialog.message}</p>

        <div className="app-dialog-actions">
          {isConfirmation && (
            <button
              ref={cancelButtonRef}
              type="button"
              className="btn btn-ghost"
              onClick={() => onClose(false)}
            >
              {dialog.cancelText}
            </button>
          )}

          <button
            ref={primaryButtonRef}
            type="button"
            className={dialog.confirmClassName}
            onClick={() => onClose(true)}
          >
            {dialog.confirmText}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

export function AppDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const activeDialogRef = useRef(null);

  const closeDialog = useCallback((result) => {
    const activeDialog = activeDialogRef.current;

    if (!activeDialog) {
      return;
    }

    activeDialogRef.current = null;
    setDialog(null);
    activeDialog.resolve(result);
  }, []);

  const openDialog = useCallback((kind, message, options = {}) => {
    return new Promise((resolve) => {
      const previousDialog = activeDialogRef.current;

      if (previousDialog) {
        previousDialog.resolve(getDialogCloseResult(previousDialog.kind));
      }

      const nextDialog = {
        ...createDialogConfig(kind, message, options),
        resolve
      };

      activeDialogRef.current = nextDialog;
      setDialog(nextDialog);
    });
  }, []);

  const confirm = useCallback(
    (message, titleOrOptions) => {
      const options = normalizeDialogOptions(titleOrOptions);

      return openDialog("confirm", message, options);
    },
    [openDialog]
  );

  const alert = useCallback(
    (message, titleOrOptions) => {
      const options = normalizeDialogOptions(titleOrOptions);

      return openDialog("alert", message, options);
    },
    [openDialog]
  );

  useEffect(() => {
    return () => {
      const activeDialog = activeDialogRef.current;

      if (!activeDialog) {
        return;
      }

      activeDialogRef.current = null;
      activeDialog.resolve(getDialogCloseResult(activeDialog.kind));
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      alert,
      confirm
    }),
    [alert, confirm]
  );

  return (
    <DialogContext.Provider value={contextValue}>
      {children}

      {dialog && <DialogModal dialog={dialog} onClose={closeDialog} />}
    </DialogContext.Provider>
  );
}

export function useAppDialog() {
  const context = useContext(DialogContext);

  if (!context) {
    throw new Error(
      "useAppDialog должен использоваться внутри AppDialogProvider"
    );
  }

  return context;
}

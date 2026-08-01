import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Info, X } from "lucide-react";

const DialogContext = createContext(null);

export function AppDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const dialogRef = useRef(null);
  const cancelButtonRef = useRef(null);
  const primaryButtonRef = useRef(null);

  const openDialog = useCallback(
    (kind, message, title) =>
      new Promise((resolve) => setDialog({ kind, message, resolve, title })),
    [],
  );
  const confirm = useCallback(
    (message, title = "\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435") =>
      openDialog("confirm", message, title),
    [openDialog],
  );
  const alert = useCallback(
    (message, title = "\u0423\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u0435") => openDialog("alert", message, title),
    [openDialog],
  );
  const close = useCallback((value) => {
    setDialog((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!dialog) return undefined;

    const previouslyFocused = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(dialog.kind === "confirm" ? false : true);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => {
      (dialog.kind === "confirm" ? cancelButtonRef.current : primaryButtonRef.current)?.focus();
    });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused instanceof HTMLElement && previouslyFocused.focus();
    };
  }, [close, dialog]);

  const isConfirmation = dialog?.kind === "confirm";

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}
      {dialog && (
        <div
          className="app-dialog-backdrop"
          onMouseDown={() => close(isConfirmation ? false : true)}
        >
          <section
            ref={dialogRef}
            className="app-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            aria-describedby="app-dialog-message"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="app-dialog-close"
              aria-label="\u0417\u0430\u043a\u0440\u044b\u0442\u044c"
              onClick={() => close(isConfirmation ? false : true)}
            >
              <X size={18} />
            </button>
            <div className="app-dialog-icon">
              {isConfirmation ? <AlertTriangle size={22} /> : <Info size={22} />}
            </div>
            <span>
              {isConfirmation
                ? "\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044f \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435"
                : "\u041a\u0430\u0440\u0430\u043e\u043a\u0435 Studio"}
            </span>
            <h2 id="app-dialog-title">{dialog.title}</h2>
            <p id="app-dialog-message">{dialog.message}</p>
            <div className="app-dialog-actions">
              {isConfirmation && (
                <button
                  ref={cancelButtonRef}
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => close(false)}
                >
                  \u041e\u0442\u043c\u0435\u043d\u0430
                </button>
              )}
              <button
                ref={primaryButtonRef}
                type="button"
                className={isConfirmation ? "btn btn-danger" : "btn btn-primary"}
                onClick={() => close(true)}
              >
                {isConfirmation ? "\u0423\u0434\u0430\u043b\u0438\u0442\u044c" : "\u041f\u043e\u043d\u044f\u0442\u043d\u043e"}
              </button>
            </div>
          </section>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useAppDialog() {
  const dialog = useContext(DialogContext);
  if (!dialog) throw new Error("Dialog provider missing");
  return dialog;
}

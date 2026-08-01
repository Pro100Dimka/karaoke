import { createContext, useCallback, useContext, useState } from "react";
import { AlertTriangle, Info, X } from "lucide-react";

const DialogContext = createContext(null);

export function AppDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);

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
            className="app-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label={dialog.title}
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
            <h2>{dialog.title}</h2>
            <p>{dialog.message}</p>
            <div className="app-dialog-actions">
              {isConfirmation && (
                <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
                  \u041e\u0442\u043c\u0435\u043d\u0430
                </button>
              )}
              <button
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

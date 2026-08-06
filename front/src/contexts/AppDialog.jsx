import { AlertTriangle, Info } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import Modal from "../components/Modal";
import { Button } from "../components/fields";
import { ModalTitle } from "../components/ui";
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
  const isConfirmation = dialog.kind === "confirm";
  const closeResult = getDialogCloseResult(dialog.kind);
  const Icon = isConfirmation ? AlertTriangle : Info;

  return (
    <Modal
      isOpen
      onClose={() => onClose(closeResult)}
      ariaLabel={dialog.title}
      backdropClassName="app-modal-backdrop app-dialog-backdrop"
      modalClassName="app-modal modal-card app-dialog"
      closeClassName="app-modal-close app-dialog-close"
      cardVariant="neon"
      closeIconSize={18}
      portal
    >
      <ModalTitle
        icon={Icon}
        eyebrow={dialog.label}
        title={dialog.title}
        description={dialog.message}
      />

      <div className="app-dialog-body">
        <div className="app-dialog-actions">
          {isConfirmation && (
            <Button variant="ghost" onClick={() => onClose(false)}>
              {dialog.cancelText}
            </Button>
          )}

          <Button
            unstyled
            className={dialog.confirmClassName}
            onClick={() => onClose(true)}
          >
            {dialog.confirmText}
          </Button>
        </div>
      </div>
    </Modal>
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

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
import Modal from "../components/modal";
import { translateSaved } from "../i18n/runtime";
import { Button } from "../theme/ui";
import { createDialogConfig, getDialogCloseResult, normalizeDialogOptions } from "./dialog-utils";

const DIALOG_CONTEXT_KEY = Symbol.for("advoice.app-dialog-context");
const DialogContext = globalThis[DIALOG_CONTEXT_KEY] ?? createContext(null);
globalThis[DIALOG_CONTEXT_KEY] = DialogContext;
export function resolveDialog(dialog, result) {
  dialog?.resolve(result);
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
      titleProps={{
        icon: Icon,
        eyebrow: dialog.label,
        title: dialog.title,
        description: dialog.message,
        actions: (
          <Button
            unstyled
            className={`${dialog.confirmClassName} modal-title-action`.trim()}
            onClick={() => onClose(true)}
          >
            {dialog.confirmText}
          </Button>
        )
      }}
    >
      {isConfirmation && (
        <div className="app-dialog-body">
          <div className="app-dialog-actions u-actions-end">
            <Button variant="ghost" onClick={() => onClose(false)}>
              {dialog.cancelText}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
export function AppDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const activeDialogRef = useRef(null);
  // Callback dependencies are stable React setters/refs.
  // Stryker disable ArrayDeclaration
  const closeDialog = useCallback((result) => {
    const activeDialog = activeDialogRef.current;
    activeDialogRef.current = null;
    setDialog(null);
    resolveDialog(activeDialog, result);
  }, []);
  // Stryker restore ArrayDeclaration
  // Callback dependencies are stable React setters/refs.
  // Stryker disable ArrayDeclaration
  const openDialog = useCallback((kind, message, options = {}) => {
    return new Promise((resolve) => {
      const previousDialog = activeDialogRef.current;
      if (previousDialog) previousDialog.resolve(getDialogCloseResult(previousDialog.kind));
      const nextDialog = { ...createDialogConfig(kind, message, options), resolve };
      activeDialogRef.current = nextDialog;
      setDialog(nextDialog);
    });
  }, []);
  // Stryker restore ArrayDeclaration
  const confirm = useCallback(
    (message, titleOrOptions) => {
      const options = normalizeDialogOptions(titleOrOptions);
      return openDialog("confirm", message, options);
    },
    // openDialog is stable for the provider lifetime.
    // Stryker disable next-line ArrayDeclaration
    [openDialog]
  );
  const alert = useCallback(
    (message, titleOrOptions) => {
      const options = normalizeDialogOptions(titleOrOptions);
      // createDialogConfig normalizes every non-confirm kind to alert.
      // Stryker disable next-line StringLiteral
      return openDialog("alert", message, options);
    },
    // openDialog is stable for the provider lifetime.
    // Stryker disable next-line ArrayDeclaration
    [openDialog]
  );
  // Cleanup closes only over the stable active-dialog ref.
  // Stryker disable ArrayDeclaration
  useEffect(() => {
    return () => {
      const activeDialog = activeDialogRef.current;
      if (!activeDialog) return;
      activeDialogRef.current = null;
      activeDialog.resolve(getDialogCloseResult(activeDialog.kind));
    };
  }, []);
  // Stryker restore ArrayDeclaration
  const contextValue = useMemo(
    () => ({ alert, confirm }),
    // alert/confirm are stable provider callbacks.
    // Stryker disable next-line ArrayDeclaration
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
    throw new Error(translateSaved("useAppDialog должен использоваться внутри AppDialogProvider"));
  }
  return context;
}

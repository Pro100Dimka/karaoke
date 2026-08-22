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

import { translateSaved as t } from "../i18n/runtime";
import { Button, Modal, Stack } from "../theme/ui";
import { createDialogConfig, getDialogCloseResult, normalizeDialogOptions } from "./dialog-utils";

const key = Symbol.for("advoice.app-dialog-context");
if (!globalThis[key]) globalThis[key] = createContext(null);
const DialogContext = globalThis[key];
export const resolveDialog = (dialog, result) => dialog?.resolve(result);

function DialogModal({ dialog, close }) {
  const confirm = dialog.kind === "confirm";
  return (
    <Modal
      isOpen
      onClose={() => close(getDialogCloseResult(dialog.kind))}
      ariaLabel={dialog.title}
      cardVariant="neon"
      closeIconSize={18}
      size="sm"
      portal
      titleProps={{
        icon: confirm ? AlertTriangle : Info,
        eyebrow: dialog.label,
        title: dialog.title,
        description: dialog.message,
        actions: (
          <Button className={dialog.confirmClassName} onClick={() => close(true)}>
            {dialog.confirmText}
          </Button>
        )
      }}
    >
      {confirm && (
        <Stack align="end" sx={{ padding: "var(--space-4)" }}>
          <Button data-role="dialog-cancel" variant="ghost" onClick={() => close(false)}>
            {dialog.cancelText}
          </Button>
        </Stack>
      )}
    </Modal>
  );
}

export function AppDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const active = useRef(null);
  const close = useCallback((result) => {
    const { current } = active;
    active.current = null;
    setDialog(null);
    resolveDialog(current, result);
  }, []);
  const open = useCallback((kind, message, options) => {
    const previous = active.current;
    resolveDialog(previous, getDialogCloseResult(previous?.kind));
    return new Promise((resolve) => {
      const next = { ...createDialogConfig(kind, message, options), resolve };
      active.current = next;
      setDialog(next);
    });
  }, []);
  const value = useMemo(
    () => ({
      alert: (message, options) => open("alert", message, normalizeDialogOptions(options)),
      confirm: (message, options) => open("confirm", message, normalizeDialogOptions(options))
    }),
    [open]
  );
  useEffect(
    () => () => {
      const { current } = active;
      active.current = null;
      resolveDialog(current, getDialogCloseResult(current?.kind));
    },
    []
  );
  return (
    <DialogContext.Provider value={value}>
      {children}
      {dialog && <DialogModal dialog={dialog} close={close} />}
    </DialogContext.Provider>
  );
}

export function useAppDialog() {
  const value = useContext(DialogContext);
  if (!value) throw new Error(t("useAppDialog должен использоваться внутри AppDialogProvider"));
  return value;
}

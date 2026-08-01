import { createContext, useCallback, useContext, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

const DialogContext = createContext(null);

export function AppDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const confirm = useCallback((message, title = "Подтвердите действие") => new Promise((resolve) => setDialog({ message, resolve, title })), []);
  const close = (value) => { dialog?.resolve(value); setDialog(null); };
  return <DialogContext.Provider value={{ confirm }}>{children}{dialog && <div className="app-dialog-backdrop" onMouseDown={() => close(false)}><section className="app-dialog" role="alertdialog" onMouseDown={(event) => event.stopPropagation()}><button className="app-dialog-close" onClick={() => close(false)}><X size={18} /></button><div className="app-dialog-icon"><AlertTriangle size={22} /></div><span>ТРЕБУЕТСЯ ПОДТВЕРЖДЕНИЕ</span><h2>{dialog.title}</h2><p>{dialog.message}</p><div className="app-dialog-actions"><button className="btn btn-ghost" onClick={() => close(false)}>Отмена</button><button className="btn btn-danger" onClick={() => close(true)}>Удалить</button></div></section></div>}</DialogContext.Provider>;
}
export function useAppDialog() { const dialog = useContext(DialogContext); if (!dialog) throw new Error("Dialog provider missing"); return dialog; }

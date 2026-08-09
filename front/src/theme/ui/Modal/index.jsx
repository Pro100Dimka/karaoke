import { useEffect, useRef } from "react";
import "./modal.css";

export default function Modal({
  open,
  onClose,
  children,
  closeOnBackdrop = true,
  className = ""
}) {
  const ref = useRef(null);
  const requestedCloseRef = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      requestedCloseRef.current = false;
      dialog.showModal();
    } else if (!open && dialog.open) {
      requestedCloseRef.current = true;
      dialog.close();
    }
  }, [open]);

  const requestClose = event => {
    if (requestedCloseRef.current) return;
    requestedCloseRef.current = true;
    onClose?.(event);
  };

  return (
    <dialog
      ref={ref}
      className={`ui-modal ${className}`.trim()}
      onCancel={event => {
        event.preventDefault();
        requestClose(event);
      }}
      onClose={event => {
        if (open) requestClose(event);
        requestedCloseRef.current = false;
      }}
      onPointerDown={event => {
        if (!closeOnBackdrop || event.target !== event.currentTarget) return;

        const rect = event.currentTarget.getBoundingClientRect();
        const inside =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;

        if (!inside) requestClose(event);
      }}
    >
      {children}
    </dialog>
  );
}

import Modal from "../../../components/Modal";

export default function LibraryModal({
  ariaLabel,
  children,
  isOpen,
  modalClassName,
  onClose
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={ariaLabel}
      backdropClassName="app-modal-backdrop song-recordings-backdrop"
      modalClassName={`app-modal modal-card ${modalClassName}`}
      closeClassName="app-modal-close song-recordings-close"
      cardVariant="neon"
      closeIconSize={18}
      portal
    >
      {children}
    </Modal>
  );
}

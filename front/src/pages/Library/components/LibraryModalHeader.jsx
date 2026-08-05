import { ModalTitle } from "../../../components/ui";

export default function LibraryModalHeader({
  icon,
  eyebrow,
  title,
  description,
  actions,
  className = ""
}) {
  return (
    <ModalTitle
      icon={icon}
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={actions}
      className={`library-modal-title ${className}`.trim()}
    />
  );
}

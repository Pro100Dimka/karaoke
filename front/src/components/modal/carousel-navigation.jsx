import { ChevronLeft, ChevronRight } from "lucide-react";
import { translateSaved } from "../../i18n/runtime";
import { Button } from "../../theme/ui";

export default function ModalCarouselNavigation({
  ariaLabel,
  className = "",
  metaClassName = "",
  index,
  count,
  title,
  subtitle,
  previousLabel = translateSaved("Назад"),
  nextLabel = translateSaved("Вперёд"),
  onPrevious,
  onNext
}) {
  if (count <= 1) return null;
  return (
    <div className={`modal-carousel ${className}`.trim()} aria-label={ariaLabel}>
      <Button
        icon={ChevronLeft}
        variant="ghost"
        aria-label={previousLabel}
        disabled={index <= 0}
        onClick={onPrevious}
      />
      <div className={`modal-carousel__meta ${metaClassName}`.trim()} aria-live="polite">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      <Button
        icon={ChevronRight}
        variant="ghost"
        aria-label={nextLabel}
        disabled={index >= count - 1}
        onClick={onNext}
      />
    </div>
  );
}

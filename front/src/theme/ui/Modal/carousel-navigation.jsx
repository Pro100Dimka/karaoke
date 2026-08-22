import { ChevronLeft, ChevronRight } from "lucide-react";
import IconButton from "../IconButton";
import Stack from "../Stack";
import Typography from "../Typography";

export default function ModalCarouselNavigation({
  ariaLabel,
  index,
  count,
  title,
  subtitle,
  previousLabel = "Назад",
  nextLabel = "Вперёд",
  onPrevious,
  onNext
}) {
  if (count <= 1) return null;
  return (
    <Stack
      className="ui-modal-carousel"
      direction="row"
      align="center"
      justify="space-between"
      aria-label={ariaLabel}
    >
      <IconButton
        icon={ChevronLeft}
        label={previousLabel}
        disabled={index <= 0}
        onClick={onPrevious}
      />
      <Stack align="center" gap="var(--space-1)" aria-live="polite">
        <Typography noWrap>{title}</Typography>
        {subtitle && (
          <Typography variant="caption" tone="muted">
            {subtitle}
          </Typography>
        )}
      </Stack>
      <IconButton
        icon={ChevronRight}
        label={nextLabel}
        disabled={index >= count - 1}
        onClick={onNext}
      />
    </Stack>
  );
}

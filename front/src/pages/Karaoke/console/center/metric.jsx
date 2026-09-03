import { Minus, Plus } from "lucide-react";
import { Card, IconButton, Stack, Typography } from "../../../../theme/ui";

const Step = ({ icon = Minus, label, onClick }) => {
  return (
    onClick && (
      <IconButton
        icon={icon}
        label={label}
        title={label}
        size="sm"
        variant="outline"
        onClick={onClick}
      />
    )
  );
};

export default ({
  label,
  value,
  tone,
  previous = Minus,
  next = Plus,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext
}) => {
  return (
    <Card tilt={false} style={{ "--card-border": tone }}>
      <Stack align="center" gap="var(--space-1)" sx={{ padding: "var(--space-2) 0" }}>
        <Typography variant="caption" style={{ color: tone }}>
          {label}
        </Typography>

        <Stack direction="row" align="center" justify="space-around">
          <Step icon={previous} label={previousLabel} onClick={onPrevious} />
          <Typography variant="body2">
            <strong>{value}</strong>
          </Typography>
          <Step icon={next} label={nextLabel} onClick={onNext} />
        </Stack>
      </Stack>
    </Card>
  );
};

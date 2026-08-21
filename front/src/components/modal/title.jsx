import { Box, Stack } from "../../theme/ui";

export default function ModalTitle({
  icon: Icon,
  image,
  onImageError,
  eyebrow,
  title,
  description,
  actions
}) {
  return (
    <Stack direction="row" align="center" justify="space-between" p="2rem" gap="2rem" pb="0">
      {(Icon || image) && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 auto",
            width: image ? "4.8rem" : undefined,
            height: image ? "4.8rem" : undefined,
            padding: image ? 0 : "1.2rem",
            overflow: "hidden",
            border: `var(--hairline) solid var(--color-border-strong)`,
            borderRadius: `var(--radius-lg)`,
            color: `var(--color-primary-hover)`,
            background: `radial-gradient(
      circle at 32% 24%,
      color-mix(in srgb, var(--color-highlight) 16%, transparent),
      transparent 42%
),
    color-mix(in srgb, var(--color-primary) 14%, var(--color-surface-glass))`,
            boxShadow: `var(--shadow-neon-soft),
    inset 0 var(--hairline)
      color-mix(in srgb, var(--color-highlight) 12%, transparent)`
          }}
        >
          {image ? (
            <img
              className="modal-title__image"
              src={image}
              alt=""
              decoding="async"
              onError={onImageError}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            Icon && <Icon size={24} />
          )}
        </Box>
      )}
      <Stack align="start">
        {eyebrow && <span className="modal-title__eyebrow">{eyebrow}</span>}
        <h1 className="modal-title__heading">{title}</h1>
        {description && <p className="modal-title__description">{description}</p>}
      </Stack>
      {actions && <div className="modal-title__actions">{actions}</div>}
    </Stack>
  );
}

import darkIcon from "../../../assets/icons/dark.png";
import greenIcon from "../../../assets/icons/green.png";
import lightIcon from "../../../assets/icons/light.png";
import violetIcon from "../../../assets/icons/violet.png";

import useAppSettings from "../../../hooks/useAppSettings";
import { Box, Stack, Typography } from "../../../theme/ui";

const STATS = [
  ["всего песен", "songCount"],
  ["готово к караоке", "readyCount"]
];

const THEME_ICONS = {
  dark: darkIcon,
  light: lightIcon,
  green: greenIcon,
  violet: violetIcon
};

const LIB_INFO = [
  ["body1", "Ваша музыкальная коллекция"],
  ["h1", "Библиотека песен"],
  [
    "body2",
    "Добавляйте треки, управляйте обработкой и открывайте их в караоке."
  ]
];

export default function LibraryHero({ songCount, readyCount }) {
  const { theme } = useAppSettings()?.settings || {};
  const values = { songCount, readyCount };

  return (
    <Stack direction="row" align="center" justify="space-between" py="2rem">
      <Stack direction="row" align="center" gap="2rem">
        <Box sx={{ width: "91px", height: "91px", flex: "0 0 91px" }}>
          <img
            src={THEME_ICONS[theme] ?? THEME_ICONS.dark}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        </Box>
        <Stack direction="column" align="flex-start" sx={{ textAlign: "left" }}>
          {LIB_INFO.map(([variant, text]) => (
            <Typography key={variant} variant={variant}>
              {text}
            </Typography>
          ))}
        </Stack>
      </Stack>
      <Stack direction="row" gap="2rem">
        {STATS.map(([label, key]) => (
          <Box
            key={key}
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "20px",
              border:
                "1px solid color-mix(in srgb, var(--color-primary) 42%, transparent)",
              background:
                "color-mix(in srgb, var(--color-bg-deep) 88%, transparent)"
            }}
          >
            <Typography
              variant="h3"
              sx={{
                fontSize: "28px",
                fontWeight: 900,
                lineHeight: 1
              }}
            >
              {values[key]}
            </Typography>

            <Typography
              variant="caption"
              sx={{
                marginTop: "14px",
                color: "var(--color-text-muted)",
                fontWeight: 700,
                whiteSpace: "nowrap"
              }}
            >
              {label}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}

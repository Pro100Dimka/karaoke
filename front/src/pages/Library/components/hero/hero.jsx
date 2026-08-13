import darkIcon from "../../../../assets/icons/dark.png";
import greenIcon from "../../../../assets/icons/green.png";
import lightIcon from "../../../../assets/icons/light.png";
import violetIcon from "../../../../assets/icons/violet.png";
import useAppSettings from "../../../../hooks/useAppSettings";
import { translateSaved } from "../../../../i18n/runtime";
import { Box, Card, Stack, Typography } from "../../../../theme/ui";

const STATS = [
  [translateSaved("всего песен"), "songCount"],
  [translateSaved("готово к караоке"), "readyCount"]
];
const THEME_ICONS = {
  dark: darkIcon,
  light: lightIcon,
  green: greenIcon,
  violet: violetIcon
};
const LIB_INFO = [
  ["body1", translateSaved("Ваша музыкальная коллекция")],
  ["h1", translateSaved("Библиотека песен")],
  [
    "body2",
    translateSaved(
      "Добавляйте треки, управляйте обработкой и открывайте их в караоке."
    )
  ]
];
export default function LibraryHero({ songCount, readyCount }) {
  const { theme } = useAppSettings()?.settings || {};
  const values = {
    songCount,
    readyCount
  };
  return (
    <Stack direction="row" align="center" justify="space-between">
      <Stack direction="row" align="center" gap="2rem">
        <Box
          sx={{
            width: "91px",
            height: "91px",
            flex: "0 0 91px"
          }}
        >
          <img
            src={THEME_ICONS[theme] ?? THEME_ICONS.dark}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain"
            }}
          />
        </Box>
        <Stack
          direction="column"
          align="flex-start"
          sx={{
            textAlign: "left"
          }}
        >
          {LIB_INFO.map(([variant, text]) => (
            <Typography key={variant} variant={variant}>
              {text}
            </Typography>
          ))}
        </Stack>
      </Stack>
      <Stack direction="row" gap="2rem" justify="flex-end">
        {STATS.map(([label, key]) => (
          <Card
            key={key}
            sx={{
              textAlign: "center",
              minWidth: "130px"
            }}
            cardContent={{
              style: {
                padding: "1rem"
              }
            }}
            variant="animation"
          >
            <Typography variant="h3">{values[key]}</Typography>
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
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}

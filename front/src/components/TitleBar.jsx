import { Maximize2, Minus, X } from "lucide-react";
import { useI18n } from "../i18n";
import { Box, IconButton, Stack } from "../theme/ui";

const actions = [
  ["minimize", "common.minimizeWindow", Minus, 16],
  ["toggleFullscreen", "common.maximizeWindow", Maximize2, 14],
  ["close", "common.closeWindow", X, 16, true]
];

export default function TitleBar({ title = "A&D Voice", hideActions = false }) {
  const { t } = useI18n();
  const electron = window.electronAPI;
  const invoke = (action) =>
    Promise.resolve(electron?.[action]?.()).catch((error) =>
      console.error(`Window action failed: ${action}`, error)
    );
  return (
    <Box
      as="header"
      className="title-bar"
      aria-label={title}
      sx={{
        flex: "none",
        minBlockSize: "var(--titlebar-height)",
        WebkitAppRegion: "drag",
        background: "var(--color-bg-deep)"
      }}
    >
      <Stack
        direction="row"
        align="center"
        className="title-bar__actions"
        sx={{
          inlineSize: "auto",
          blockSize: "100%",
          marginInlineStart: "auto",
          WebkitAppRegion: "no-drag"
        }}
      >
        {!hideActions &&
          electron &&
          actions.map(([action, key, Icon, size, danger]) => (
            <IconButton
              key={action}
              unstyled
              icon={Icon}
              iconSize={size}
              label={t(key)}
              className={`title-bar__button${danger ? " is-danger" : ""}`}
              onClick={() => invoke(action)}
              sx={{
                display: "grid",
                placeItems: "center",
                inlineSize: "var(--space-10)",
                blockSize: "var(--titlebar-height)",
                border: 0,
                color: danger ? "var(--color-danger)" : "var(--color-text-muted)",
                background: "transparent"
              }}
            />
          ))}
      </Stack>
    </Box>
  );
}

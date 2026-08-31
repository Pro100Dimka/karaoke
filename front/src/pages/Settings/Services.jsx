import {
  CheckCircle2,
  CircleAlert,
  Database,
  Info,
  ListChecks,
  Stethoscope,
  Trash2
} from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { useAppDialog } from "../../contexts/AppDialog";
import { usePolling } from "../../hooks/usePolling";
import { useI18n } from "../../i18n";
import { translateSaved as tr } from "../../i18n/runtime";
import { POLLING_INTERVALS } from "../../runtime-config";
import { Button, Card, Chip, Grid, Select, Stack, Typography } from "../../theme/ui";
import { getErrorMessage } from "../../utils/errors";
import { SERVICES } from "./schema";

export const SERVICE_ICONS = {
  memory: Database,
  history: ListChecks,
  diagnostics: Stethoscope,
  about: Info
};
const panel = { padding: "1rem", border: "1px solid var(--ui-border)", borderRadius: "1rem" };

const ErrorText = ({ error }) =>
  error && (
    <Typography tone="danger" variant="body2">
      {getErrorMessage(error)}
    </Typography>
  );

const Metrics = ({ items }) => (
  <Grid columns={2} gap="var(--space-2)">
    {items.map(([label, value]) => (
      <Card key={label} sx={panel}>
        <Typography variant="caption" tone="muted">
          {label}
        </Typography>
        <Typography variant="body1" sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>
          {value ?? "—"}
        </Typography>
      </Card>
    ))}
  </Grid>
);

function About() {
  const { t } = useI18n();
  const query = usePolling(api.getAbout, POLLING_INTERVALS.about, []);
  const data = query.data ?? {};
  return (
    <Stack align="center" gap={1.2}>
      <ErrorText error={query.error} />
      <Typography variant="h2">A&amp;D Voice</Typography>
      <Typography tone="muted">{t("settings.about.description")}</Typography>
      <Metrics
        items={[
          [t("settings.about.backendVersion"), data.backend_version],
          [t("settings.about.frontendVersion"), data.frontend_version],
          [t("settings.about.aiVersion"), data.ai_version],
          [t("settings.about.dataPath"), data.data_dir]
        ]}
      />
      <Typography variant="caption" tone="muted">
        © 2026 A&amp;D Voice
      </Typography>
    </Stack>
  );
}

function Diagnostics() {
  const { t } = useI18n();
  const health = usePolling(api.getHealth, POLLING_INTERVALS.health, []).data;
  const pipeline = usePolling(api.getPipelineHealth, POLLING_INTERVALS.health, []).data;
  const versions = usePolling(api.getVersions, POLLING_INTERVALS.versions, []).data;
  const errors = usePolling(api.getErrors, POLLING_INTERVALS.errors, []).data?.errors ?? [];
  const checks = [["backend", Boolean(health)], ...Object.entries(pipeline ?? {})];
  return (
    <Stack gap={1}>
      <Grid columns={2} gap="var(--space-2)">
        {checks.map(([name, ok]) => {
          const Icon = ok ? CheckCircle2 : CircleAlert;
          return (
            <Card key={name} sx={panel}>
              <Stack direction="row" align="center" justify="space-between">
                <Typography>{t(`settings.diagnostics.${name}`, {}, name)}</Typography>
                <Icon size={18} color={`var(--ui-${ok ? "success" : "danger"})`} />
              </Stack>
            </Card>
          );
        })}
      </Grid>
      <Metrics items={Object.entries(versions?.components ?? {})} />
      <Typography variant="h3">{t("settings.diagnostics.errors")}</Typography>
      {errors.length ? (
        errors.map((error) => (
          <Card key={error.id ?? `${error.updated_at}-${error.title}`} sx={panel}>
            <Stack gap={0.25}>
              <Stack direction="row" justify="space-between">
                <Typography>{error.title}</Typography>
                <Typography variant="caption" tone="muted">
                  {error.updated_at}
                </Typography>
              </Stack>
              <Typography tone="danger" variant="body2">
                {error.error_message}
              </Typography>
            </Stack>
          </Card>
        ))
      ) : (
        <Typography tone="muted">{t("settings.diagnostics.noErrors")}</Typography>
      )}
    </Stack>
  );
}

export const formatDate = (value, language) => {
  const date = value && new Date(value);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString({ uk: "uk-UA", ru: "ru-RU", en: "en-US" }[language])
    : "—";
};

function History() {
  const { language, t } = useI18n();
  const query = usePolling(api.getHistory, POLLING_INTERVALS.history, []);
  const data = query.data ?? [];
  return (
    <Stack gap={0.75}>
      <ErrorText error={query.error} />
      {data.length ? (
        data.map((item, index) => (
          <Card key={item.id ?? `${item.timestamp}-${index}`} sx={panel}>
            <Stack direction="row" align="center" justify="space-between" gap={1}>
              <Stack gap={0.2}>
                <Typography>{item.song_title ?? "—"}</Typography>
                <Typography variant="caption" tone="muted">
                  {t(`settings.history.${item.kind}`, {}, item.kind ?? "—")} ·{" "}
                  {formatDate(item.timestamp, language)}
                </Typography>
              </Stack>
              <Chip
                tone={
                  item.status === "done"
                    ? "success"
                    : item.status === "error"
                      ? "danger"
                      : "default"
                }
              >
                {t(`status.${item.status}`, {}, item.status ?? "—")}
              </Chip>
            </Stack>
          </Card>
        ))
      ) : (
        <Typography tone="muted">{t("settings.history.empty")}</Typography>
      )}
    </Stack>
  );
}

export const formatBytes = (value) => {
  const bytes = Number(value) || 0;
  if (!bytes) return tr("settings.0B");
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  const suffix = [tr("settings.b"), tr("settings.kb"), tr("settings.mb"), tr("settings.gb")][unit];
  return `${(bytes / 1024 ** unit).toFixed(1)} ${suffix}`;
};

function Memory() {
  const { alert } = useAppDialog();
  const size = usePolling(api.getCacheSize, POLLING_INTERVALS.memory, []);
  const free = usePolling(api.getFreeSpace, POLLING_INTERVALS.freeSpace, []).data;
  const songs = usePolling(api.listSongs, POLLING_INTERVALS.songs, []).data ?? [];
  const [song, setSong] = useState("");
  const run = async (request, message) => {
    try {
      await alert(message(await request()));
    } catch (error) {
      await alert(getErrorMessage(error));
    }
  };
  const actions = [
    [tr("settings.clearCache"), api.clearCache],
    [tr("settings.deleteTemporaryFiles"), api.deleteTemp]
  ];
  const options = [
    { value: "", label: tr("settings.selectASong") },
    ...songs
      .filter(({ status, optimized }) => status === "done" && !optimized)
      .map(({ id: value, title: label }) => ({ value, label }))
  ];
  return (
    <Stack gap={1}>
      <ErrorText error={size.error} />
      <Metrics
        items={[
          [tr("settings.memory.total"), size.data?.total_human],
          [tr("settings.memory.free"), free?.free_human]
        ]}
      />
      <Metrics
        items={Object.entries(size.data?.breakdown ?? {}).map(([key, value]) => [
          key,
          formatBytes(value)
        ])}
      />
      <Stack direction="row" wrap gap={0.75}>
        {actions.map(([label, request]) => (
          <Button
            key={label}
            variant="outlined"
            startIcon={<Trash2 />}
            onClick={() =>
              run(
                request,
                (result) => `${tr("settings.freed")}: ${formatBytes(result?.freed_bytes)}`
              )
            }
          >
            {label}
          </Button>
        ))}
      </Stack>
      <Grid columns={2} gap="var(--space-2)" align="end">
        <Select
          label={tr("settings.history.song")}
          value={song}
          options={options}
          onChange={setSong}
        />
        <Button
          variant="contained"
          disabled={!song}
          onClick={() =>
            run(
              () => api.optimizeSong(song),
              (result) => `${tr("settings.freed")}: ${result?.freed_human ?? "—"}`
            )
          }
        >
          {tr("settings.memory.optimize")}
        </Button>
      </Grid>
    </Stack>
  );
}

const SCREENS = { memory: Memory, history: History, diagnostics: Diagnostics, about: About };

export function ServiceCards({ open }) {
  const { t } = useI18n();
  return (
    <Grid columns={2} gap="var(--space-2)" sx={{ padding: "1rem" }}>
      {SERVICES.map((id) => {
        const Icon = SERVICE_ICONS[id];
        return (
          <Card
            key={id}
            as="button"
            interactive
            variant="neon"
            tilt={false}
            onClick={() => open(id)}
            sx={{ cursor: "pointer", textAlign: "left", padding: 0 }}
            cardContent={{ style: panel }}
          >
            <Stack gap={0.35}>
              <Icon size={20} />
              <Typography sx={{ fontWeight: 800 }}>{t(`settings.service.${id}.title`)}</Typography>
              <Typography tone="muted" variant="body2">
                {t(`settings.service.${id}.text`)}
              </Typography>
            </Stack>
          </Card>
        );
      })}
    </Grid>
  );
}

export function Service({ id }) {
  const Screen = SCREENS[id];
  if (!Screen) return null;
  return (
    <Stack gap={1} sx={{ padding: "1.25rem" }}>
      <Screen />
    </Stack>
  );
}

import { getIn, setIn } from "formik";
import { ArrowLeft, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { Button, Modal, RenderFormikFields, Tabs, Typography, useGetForm } from "../../theme/ui";
import { getErrorMessage } from "../../utils/errors";
import * as platform from "../../utils/platform";
import { Service, SERVICE_ICONS, ServiceCards } from "./Services";
import appearanceRows from "./appearance-rows";
import audioRows from "./audio-rows";
import processingRows from "./processing-rows";
import { TABS } from "./schema";
import useSettings from "./use-settings";

export default function Settings({ isOpen = true, onClose, initialTab = "appearance" }) {
  const { t } = useI18n();
  const [tab, setTab] = useState(initialTab);
  const [service, setService] = useState(null);
  const settings = useSettings(isOpen);
  const incoming = {
    ...settings.app.form,
    audio: settings.audio.values ?? {},
    monitor: { wasapiMode: settings.audio.wasapiMode ?? "shared" },
    radio: {
      enabled: !!settings.radio.isPlaying,
      stationId: settings.radio.stationId ?? "",
      volume: settings.radio.volume ?? 0
    }
  };
  const previous = useRef(incoming);
  const formik = useGetForm({
    initialValues: incoming,
    enableReinitialize: false,
    onSubmit: async (values) => {
      for (const { tag } of rows[tab] ?? []) {
        if (tag && !tag.includes(".") && values[tag] !== settings.app.form[tag])
          await save(tag, values[tag]);
      }
    }
  });
  const run = async (action) => {
    formik.setStatus(undefined);
    try {
      await action();
    } catch (error) {
      formik.setStatus(getErrorMessage(error));
    }
  };
  const save = (name, value) =>
    run(async () => {
      if (name.startsWith("audio.")) return settings.audio.update(name.slice(6), value);
      if (Object.is(value, settings.app.form[name] ?? "")) return;
      settings.app.change(name, value);
      await settings.app.save(name, value);
    });
  const rows = {
    appearance: appearanceRows({ settings, tr: t }),
    audio: audioRows({ settings, run, tr: t }),
    ai: processingRows({ tr: t }),
    advanced: [{ md: 12, render: () => <ServiceCards open={setService} /> }]
  };
  console.log(rows);

  const { values, setValues } = formik;
  // Sync changed backend fields only; preserve drafts and touched state during polling.
  useEffect(() => {
    let next = values;
    for (const { tag } of Object.values(rows).flat()) {
      if (!tag) continue;
      const before = getIn(previous.current, tag, ""),
        after = getIn(incoming, tag, "");
      if (!Object.is(before, after) && Object.is(getIn(values, tag, ""), before))
        next = setIn(next, tag, after);
    }
    previous.current = incoming;
    if (next !== values) setValues(next, false);
  }, [incoming, rows, values, setValues]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t("settings.title")}
      titleProps={{
        icon: SERVICE_ICONS[service] ?? Settings2,
        eyebrow: t("settings.eyebrow"),
        title: service ? t(`settings.service.${service}.title`) : t("settings.title"),
        description: service ? t(`settings.service.${service}.text`) : t("settings.description"),
        actions: service && (
          <Button variant="outlined" startIcon={<ArrowLeft />} onClick={() => setService(null)}>
            {t("settings.back")}
          </Button>
        )
      }}
    >
      <Tabs
        value={tab}
        onChange={(value) => {
          setTab(value);
          setService(null);
        }}
        items={TABS.map(([id, label, Icon]) => ({
          value: id,
          label: t(label),
          icon: <Icon size={17} />,
          content:
            !settings.app.form && id !== "advanced" ? (
              <Typography sx={{ padding: "1rem" }} role={settings.app.error ? "alert" : undefined}>
                {settings.app.error ? getErrorMessage(settings.app.error) : t("settings.loading")}
              </Typography>
            ) : (
              <form noValidate onSubmit={formik.handleSubmit}>
                <RenderFormikFields
                  formik={formik}
                  onFieldCommit={save}
                  pickFolder={platform.canPickFolder() ? platform.pickFolder : undefined}
                  items={(service
                    ? [{ md: 12, render: () => <Service id={service} /> }]
                    : rows[id]
                  ).map((row) => ({ xs: 12, md: 6, ...row }))}
                  sx={{ padding: "1rem", maxWidth: "72rem", marginInline: "auto" }}
                />
                {formik.status && (
                  <Typography tone="danger" role="alert">
                    {formik.status}
                  </Typography>
                )}
              </form>
            )
        }))}
      />
    </Modal>
  );
}

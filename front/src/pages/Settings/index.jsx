import { getIn, setIn } from "formik";
import { ArrowLeft, Settings2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { Button, Modal, RenderFormikFields, Tabs, Typography, useGetForm } from "../../theme/ui";
import { getErrorMessage } from "../../utils/errors";
import * as platform from "../../utils/platform";
import { Service, SERVICE_ICONS, ServiceCards } from "./Services";
import appearance from "./rows/appearance";
import audio from "./rows/audio";
import processing from "./rows/processing";
import { TABS } from "./schema";
import useSettings from "./use-settings";

export default function Settings({ isOpen = true, onClose, initialTab = "appearance" }) {
  const { t } = useI18n();
  const s = useSettings(isOpen);
  const [tab, setTab] = useState(initialTab);
  const [service, setService] = useState();

  const incoming = useMemo(
    () => ({
      ...s.app.form,
      audio: s.audio.values ?? {},
      radio: {
        enabled: !!s.radio.isPlaying,
        stationId: s.radio.stationId ?? "",
        volume: s.radio.volume ?? 0
      }
    }),
    [s.app.form, s.audio.values, s.radio.isPlaying, s.radio.stationId, s.radio.volume]
  );

  const previous = useRef(incoming);

  const formik = useGetForm({
    initialValues: incoming,
    enableReinitialize: false,
    onSubmit: async (values) => {
      for (const { tag } of rows[tab] ?? [])
        if (tag && !tag.includes(".") && values[tag] !== s.app.form?.[tag])
          await save(tag, values[tag]);
    }
  });

  const run = async (fn) => {
    formik.setStatus();
    try {
      await fn();
    } catch (e) {
      formik.setStatus(getErrorMessage(e));
    }
  };

  const save = (tag, value) =>
    run(async () => {
      if (tag.startsWith("audio.")) return s.audio.update(tag.slice(6), value);
      if (Object.is(value, s.app.form?.[tag] ?? "")) return;

      s.app.change(tag, value);
      await s.app.save(tag, value);
    });

  const rows = useMemo(
    () => ({
      appearance: appearance({ settings: s, tr: t }),
      audio: audio({ settings: s, run, tr: t }),
      ai: processing({ tr: t }),
      advanced: [{ md: 12, render: () => <ServiceCards open={setService} /> }]
    }),
    [s, t]
  );

  useEffect(() => {
    let next = formik.values;

    for (const { tag } of Object.values(rows).flat()) {
      if (!tag) continue;

      const before = getIn(previous.current, tag, "");
      const after = getIn(incoming, tag, "");

      if (!Object.is(before, after) && Object.is(getIn(next, tag, ""), before))
        next = setIn(next, tag, after);
    }

    previous.current = incoming;
    if (next !== formik.values) formik.setValues(next, false);
  }, [incoming, rows, formik.values, formik.setValues]);

  const renderTab = (id) => {
    if (!s.app.form && id !== "advanced")
      return (
        <Typography sx={{ padding: "1rem" }} role={s.app.error ? "alert" : undefined}>
          {s.app.error ? getErrorMessage(s.app.error) : t("settings.loading")}
        </Typography>
      );

    const items = service ? [{ md: 12, render: () => <Service id={service} /> }] : rows[id];

    return (
      <form noValidate onSubmit={formik.handleSubmit}>
        <RenderFormikFields
          formik={formik}
          items={items.map((item) => ({ xs: 12, md: 6, ...item }))}
          onFieldCommit={save}
          pickFolder={platform.canPickFolder() ? platform.pickFolder : undefined}
          sx={{ padding: "1rem", maxWidth: "72rem", marginInline: "auto" }}
        />

        {formik.status && (
          <Typography tone="danger" role="alert">
            {formik.status}
          </Typography>
        )}
      </form>
    );
  };

  const serviceKey = service && `settings.service.${service}`;
  console.log("aaaaaaaaa");

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t("settings.title")}
      titleProps={{
        icon: SERVICE_ICONS[service] ?? Settings2,
        eyebrow: t("settings.eyebrow"),
        title: t(serviceKey ? `${serviceKey}.title` : "settings.title"),
        description: t(serviceKey ? `${serviceKey}.text` : "settings.description"),
        actions: service && (
          <Button variant="outlined" startIcon={<ArrowLeft />} onClick={() => setService()}>
            {t("settings.back")}
          </Button>
        )
      }}
    >
      <Tabs
        value={tab}
        onChange={(value) => {
          setTab(value);
          setService();
        }}
        items={TABS.map(([value, label, Icon]) => ({
          value,
          label: t(label),
          icon: <Icon size={17} />,
          content: renderTab(value)
        }))}
      />
    </Modal>
  );
}

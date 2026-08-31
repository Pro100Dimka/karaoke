import { translateSaved as tr } from "../../../i18n/runtime";
import { useState } from "react";
import Grid from "../Grid";
import Typography from "../Typography";
import GetForm, { useGetForm } from "./index";

const items = [
  { type: "SimpleTextField", tag: "title", label: tr("library.sort.title"), xs: 12, md: 8, required: true },
  { type: "NumberField", tag: "bpm", label: "BPM", min: 1, max: 300, xs: 12, md: 4 },
  {
    type: "SelectField",
    tag: "language",
    label: tr("settings.appearance.language.label"),
    xs: 12,
    sm: 6,
    options: [
      { value: "ru", label: tr("settings.option.language.ru") },
      { value: "uk", label: tr("settings.ukrainian") }
    ]
  },
  { type: "SwitchField", tag: "enabled", label: tr("settings.appearance.enabled.checkedText"), xs: 12, sm: 6 },
  { type: "RotaryKnob", tag: "volume", label: tr("settings.appearance.volume.label"), min: 0, max: 1, step: 0.05, xs: 12 },
  { type: "ButtonField", label: tr("library.save"), inputType: "submit", xs: 12, sm: 6 },
  { type: "ButtonField", label: tr("library.reset"), inputType: "reset", variant: "outlined", xs: 12, sm: 6 }
];

// Standalone example: no backend requests or changes to user settings.
export default function GetFormExample() {
  const [saved, setSaved] = useState(null);
  const formik = useGetForm({
    initialValues: { title: "", bpm: 120, language: "ru", enabled: true, volume: 0.5 },
    validate: (values) => {
      const errors = {};
      if (!values.title.trim()) errors.title = tr("common.form.titleRequired");
      if (!Number.isFinite(values.bpm) || values.bpm < 1 || values.bpm > 300)
        errors.bpm = tr("common.form.bpmRange");
      return errors;
    },
    onSubmit: async (values) => setSaved(values)
  });
  return (
    <GetForm formik={formik} items={items}>
      <Grid item xs={12}>
        <Typography as="pre" role="status" aria-label={tr("common.form.result")} sx={{ whiteSpace: "pre-wrap" }}>
          {saved ? JSON.stringify(saved, null, 2) : tr("common.form.notSubmitted")}
        </Typography>
      </Grid>
    </GetForm>
  );
}

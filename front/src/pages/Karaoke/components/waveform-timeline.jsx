import { translateSaved as t } from "../../../i18n/runtime";
import { Waveform } from "../../../theme/ui";

export default function WaveformTimeline({ value, duration, onChange }) {
  return (
    <Waveform label={t("Позиция песни")} value={value} duration={duration} onChange={onChange} />
  );
}

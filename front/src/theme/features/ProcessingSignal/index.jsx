import { translateSaved as tr } from "../../../i18n/runtime";
import Waveform from "../../ui/Waveform";
import "./processing-signal.css";

const clamp = (value) => Math.min(100, Math.max(0, Number(value) || 0));

export default function ProcessingSignal({ progress = 0, compact = false, url, fetchParams }) {
  const value = clamp(progress);
  const rounded = Math.round(value);
  return (
    <figure
      className="ui-processing-signal"
      data-compact={compact || undefined}
      role="progressbar"
      aria-label={tr("common.processing", { 0: rounded })}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={rounded}
    >
      <Waveform
        label={tr("common.processing", { 0: rounded })}
        progress={value / 100}
        url={url}
        fetchParams={fetchParams}
        retryKey={url ? Math.min(8, Math.floor(value / 5)) : 0}
        compact={compact}
        interactive={false}
      />
      <strong>{rounded}%</strong>
    </figure>
  );
}

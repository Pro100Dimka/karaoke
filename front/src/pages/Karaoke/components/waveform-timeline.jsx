import { useMemo } from "react";
import { api } from "../../../api/client";
import { translateSaved as t } from "../../../i18n/runtime";
import { Waveform } from "../../../theme/ui";
import * as platform from "../../../utils/platform";

export default function WaveformTimeline({ songId, value, duration, onChange }) {
  const token = platform.apiToken();
  const fetchParams = useMemo(
    () => (token ? { headers: { "X-ADVoice-Token": token } } : undefined),
    [token]
  );
  return (
    <Waveform
      label={t("Позиция песни")}
      value={value}
      duration={duration}
      onChange={onChange}
      url={songId ? api.getAudioTrackUrl(songId, "instrumental") : ""}
      fetchParams={fetchParams}
    />
  );
}

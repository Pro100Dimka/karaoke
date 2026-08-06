import { Radio, Volume2 } from "lucide-react";
import Dropdown from "../../components/fields/Dropdown";
import Field from "../../components/fields/field";
import RangeInput from "../../components/fields/range-input";
import { useRadio } from "../../contexts/radio";

export default function RadioSettings() {
  const { stationId, stations, setStation, volume, setVolume } = useRadio();
  return (
    <div className="settings-field-grid">
      <Field label="Радиостанция" hint="Музыка, которая играет в фоне приложения" variant="card">
        <div className="radio-settings-control">
          <Radio size={18} />
          <Dropdown
            value={stationId}
            options={stations.map(({ id, name, description }) => ({
              value: id,
              label: `${name} · ${description}`
            }))}
            onChange={setStation}
          />
        </div>
      </Field>
      <Field label="Громкость радио" hint="Также доступна при наведении на кнопку радио" variant="card">
        <div className="audio-level-control">
          <Volume2 size={18} />
          <RangeInput min="0" max="1" step="0.01" value={volume} onChange={setVolume} />
          <strong>{Math.round(volume * 100)}%</strong>
        </div>
      </Field>
    </div>
  );
}

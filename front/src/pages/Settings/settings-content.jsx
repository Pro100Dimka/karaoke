import { ArrowLeft } from "lucide-react";
import FieldInput from "../../components/fields";
import Button from "../../components/fields/button";
import { SCREEN_BY_ID, SETTINGS } from "./config";

export default function SettingsContent(props) {
  const {
    tab,
    service,
    form,
    onChange,
    onFieldBlur,
    onOpenService,
    onCloseService
  } = props;
  const ServiceScreen = SCREEN_BY_ID[service]?.component;
  if (ServiceScreen) {
    return (
      <div className="settings-service-screen">
        <Button
          icon={ArrowLeft}
          variant="ghost"
          className="settings-service-back"
          onClick={onCloseService}
        >
          Назад к настройкам
        </Button>
        <ServiceScreen />
      </div>
    );
  }
  if (tab === "service") {
    return (
      <div className="settings-service-grid">
        {SETTINGS.service.screens.map(({ id, title, text }) => (
          <Button
            key={id}
            className="settings-service-link"
            onClick={() => onOpenService(id)}
          >
            <strong>{title}</strong>
            <span>{text}</span>
            <b>Открыть →</b>
          </Button>
        ))}
      </div>
    );
  }
  const section = SETTINGS[tab];
  if (!section) return null;
  const SectionComponent = section.component;
  if (SectionComponent) return <SectionComponent />;
  return (
    <div className={section.className}>
      {section.fields.map((field) => (
        <FieldInput
          key={field.name}
          field={field}
          value={form[field.name]}
          onChange={(value) => onChange(field.name, value)}
          onBlur={(value) => {
            if (field.saveOnBlur) {
              onFieldBlur(field.name, value);
            }
          }}
        />
      ))}
    </div>
  );
}

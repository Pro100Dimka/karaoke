import { translateSaved } from "../../../i18n/runtime";
import { ServiceCards } from "../Services";

export default function advancedRows({ open, removeDiagnostics, settings, tr = translateSaved }) {
  const diagnosticsEnabled = Boolean(settings.app.form?.remote_diagnostics_enabled);
  return [
    { md: 12, render: () => <ServiceCards open={open} /> },
    {
      type: "Label",
      md: 12,
      variant: "h3",
      text: tr("settings.advanced.remote_diagnostics.title")
    },
    {
      type: "SwitchField",
      tag: "remote_diagnostics_enabled",
      label: tr("settings.advanced.remote_diagnostics_enabled.label"),
      tooltip: tr("settings.advanced.remote_diagnostics_enabled.tooltip")
    },
    {
      type: "SwitchField",
      tag: "remote_diagnostics_errors_enabled",
      label: tr("settings.advanced.remote_diagnostics_errors_enabled.label"),
      tooltip: tr("settings.advanced.remote_diagnostics_errors_enabled.tooltip"),
      disabled: !diagnosticsEnabled
    },
    {
      type: "SwitchField",
      tag: "remote_diagnostics_hardware_enabled",
      label: tr("settings.advanced.remote_diagnostics_hardware_enabled.label"),
      tooltip: tr("settings.advanced.remote_diagnostics_hardware_enabled.tooltip"),
      disabled: !diagnosticsEnabled
    },
    {
      type: "SwitchField",
      tag: "remote_crash_reports_enabled",
      label: tr("settings.advanced.remote_crash_reports_enabled.label"),
      tooltip: tr("settings.advanced.remote_crash_reports_enabled.tooltip"),
      disabled: !diagnosticsEnabled
    },
    {
      type: "ButtonField",
      md: 12,
      label: tr("settings.advanced.remote_diagnostics.delete"),
      variant: "outlined",
      tone: "danger",
      disabled: !diagnosticsEnabled,
      onClick: removeDiagnostics
    }
  ];
}

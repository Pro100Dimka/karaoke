/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { verify } from "./helpers/assertions.mjs";
import { mockUseI18nWithFallback, passthrough } from "./helpers/mocks.mjs";
const mocks = vi.hoisted(() => ({
  updateUiPreferences: vi.fn(),
  radio: {},
  audio: {},
  configFormProps: null
}));
vi.mock("../src/api/client", () => ({ api: { updateUiPreferences: mocks.updateUiPreferences } }));
vi.mock("../src/contexts/radio", () => ({ useRadio: () => mocks.radio }));
vi.mock("../src/pages/Settings/audio-source", () => ({ default: () => mocks.audio }));
vi.mock("../src/pages/Settings/model-recovery", () => ({ default: () => <div>Model recovery</div> }));
vi.mock("../src/pages/Settings/config", () => {
  const Service = () => <div>Diagnostics screen</div>;
  return {
    SCREEN_BY_ID: { diagnostics: { component: Service } },
    SERVICE_SCREENS: [{ id: "diagnostics" }, { id: "history" }],
    SETTINGS: {
      general: {
        fields: [
          {
            name: "language",
            label: "Language",
            tooltip: "Choose language",
            getLabel: ({ suffix }) => `Language В· ${suffix || ""}`,
            options: [{ value: "uk", label: "Ukrainian" }]
          }
        ]
      },
      audio: {
        className: "audio-form",
        fields: [
          { name: "volume", label: "Volume" },
          { name: "buffer", label: "Buffer", advanced: true }
        ]
      },
      ai: { fields: [] },
      appearance: { fields: [] }
    }
  };
});
vi.mock("../src/i18n", async (importOriginal) => ({
  ...(await importOriginal()),
  useI18n: mockUseI18nWithFallback
}));
vi.mock("../src/theme/ui", () => ({
  Button: passthrough("button"),
  Card: ({
    children,
    as: As = "div",
    cardContent: _card,
    interactive: _interactive,
    tilt: _tilt,
    sx: _sx,
    ...props
  }) => <As {...props}>{children}</As>,
  ConfigForm: (props) => {
    mocks.configFormProps = props;
    return (
      <div>
        {props.fields.map(({ name }) => ( <span key={name}>{name}</span> ))}
      </div>
    );
  },
  Grid: ({ children }) => <div>{children}</div>,
  Progress: ({ value, ...props }) => (
    <progress max="100" value={value} {...props} />
  ),
  Stack: passthrough("div"),
  Typography: ({ children }) => <span>{children}</span>
}));
import SettingsContent from "../src/pages/Settings/settings-content.jsx";
import { SETTINGS_RENDERERS } from "../src/pages/Settings/renderers.jsx";
beforeEach(() => {
  localStorage.clear();
  mocks.updateUiPreferences.mockReset().mockResolvedValue({});
  mocks.configFormProps = null;
  mocks.radio = {};
  mocks.audio = { states: { monitorLevel: 20 } };
});
afterEach(cleanup);
const props = (overrides = {}) => ({
  tab: "general",
  service: null,
  form: {},
  onChange: vi.fn(),
  onFieldBlur: vi.fn(),
  onOpenService: vi.fn(),
  onCloseService: vi.fn(),
  ...overrides
});
describe("settings content", () => {
  test("renders translated form fields and returns null for unknown tabs", () => {
    const view = render(<SettingsContent {...props()} />);
    verify([screen.getByText("language"), 'not.toBeNull'], [mocks.configFormProps.context.form, 'toEqual', {}]);
    verify([mocks.configFormProps.fields[0].getLabel({ suffix: "UK" }), 'toContain', "UK"]);
    verify([mocks.configFormProps.fields[0].getLabel({ suffix: "" }), 'toBe', "Language"]);
    expect(mocks.configFormProps.fields[0].options[0].label).toBe("Ukrainian");
    view.rerender(<SettingsContent {...props({ tab: "missing" })} />);
    expect(view.container.textContent).toBe("");
  });
  test("reveals advanced audio settings and persists the view choice", () => {
    render(<SettingsContent {...props({ tab: "audio" })} />);
    verify([screen.getByText("volume"), 'not.toBeNull'], [screen.queryByText("buffer"), 'toBeNull']);
    fireEvent.click(screen.getByText("settings.advanced.show"));
    expect(screen.getByText("buffer")).not.toBeNull();
    verify([mocks.updateUiPreferences, 'toHaveBeenLastCalledWith', "settings", { showAdvancedAudio: true }]);
  });
  test("shows model recovery and appearance service links", () => {
    const open = vi.fn();
    const view = render(<SettingsContent {...props({ tab: "ai" })} />);
    expect(screen.getByText("Model recovery")).not.toBeNull();
    view.rerender( <SettingsContent {...props({ tab: "appearance", onOpenService: open })} />
    );
    fireEvent.click(screen.getByText("settings.service.diagnostics.title"));
    expect(open).toHaveBeenCalledWith("diagnostics");
  });
  test("opens a service screen and navigates back", () => {
    const close = vi.fn();
    render(
      <SettingsContent
        {...props({ tab: "appearance", service: "diagnostics", onCloseService: close })}
      />
    );
    expect(screen.getByText("Diagnostics screen")).not.toBeNull();
    fireEvent.click(screen.getByText("settings.back"));
    expect(close).toHaveBeenCalledOnce();
  });
});
describe("settings custom renderers", () => {
  test("runs action renderer and reflects its pending state", () => {
    const run = vi.fn();
    const context = { t: (key) => key };
    const field = {
      label: "Test",
      idleText: "Play",
      pendingText: "Playing",
      isPending: () => true,
      run
    };
    render( SETTINGS_RENDERERS.action({ props: { label: "x" }, field, context })
    );
    fireEvent.click(screen.getByText("Playing"));
    expect(run).toHaveBeenCalledWith(context);
  });
  test("runs monitor renderer and displays current level", () => {
    const run = vi.fn();
    const context = { t: (key) => key };
    const field = { label: "Monitor", run, getLevel: () => 44 };
    render( SETTINGS_RENDERERS.monitor({ props: {}, field, context, value: false })
    );
    fireEvent.click(screen.getByText("settings.audio.hearVoice"));
    verify([run, 'toHaveBeenCalledWith', context], [screen.getByRole("progressbar").value, 'toBe', 44]);
  });
  test("renders optional action and active-monitor fallbacks", () => {
    const context = { t: (key) => key };
    const action = render( SETTINGS_RENDERERS.action({ field: { label: "Fallback" }, context })
    );
    fireEvent.click(screen.getByText("Fallback"));
    action.unmount();
    render( SETTINGS_RENDERERS.monitor({ field: { label: "Monitor" }, context, value: true })
    );
    fireEvent.click(screen.getByText("settings.audio.monitorOff"));
    expect(screen.getByRole("progressbar").value).toBe(0);
  });
});

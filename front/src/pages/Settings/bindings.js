import * as platform from "../../utils/platform";

const BINDINGS = {
  app: ({ app }, name) => ({
    value: app.form[name],
    change: (value) => app.change(name, value),
    save: (value) => app.save(name, value)
  }),
  audio: ({ audio }, name) => ({
    value: audio.values[name],
    change: (value) => audio.update(name, value)
  }),
  radio: ({ radio }, name) => ({
    value: name === "enabled" ? radio.isPlaying : radio[name],
    change: (value) => {
      if (name === "enabled") return value ? radio.turnOn() : radio.turnOff();
      return radio[name === "stationId" ? "setStation" : "setVolume"](value);
    }
  })
};

const resolveOptions = (settings, definition) => {
  if (!definition.optionsKey) return definition.options;
  if (definition.source !== "radio") return settings.audio.options[definition.optionsKey];
  return settings.radio.stations.map(({ id: value, name: label, description }) => ({
    value,
    label,
    description
  }));
};

export const bindField = (settings, definition) => {
  const { source, optionsKey: _, percent, ...field } = definition;
  const binding = BINDINGS[source](settings, definition.name);
  return {
    ...field,
    options: resolveOptions(settings, definition),
    getValue: () => binding.value,
    ...(percent && { formatValue: (value) => `${Math.round(value * 100)}%` }),
    setValue: (_, value) => binding.change(value),
    saveValue: binding.save ? (_, value) => binding.save(value) : undefined,
    pick:
      definition.type === "folder" && platform.canPickFolder()
        ? async (_, value) => platform.pickFolder(value || undefined)
        : undefined
  };
};

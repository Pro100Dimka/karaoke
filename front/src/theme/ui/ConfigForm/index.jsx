import Button from "../Button";
import FolderField from "../FolderField";
import NumberField from "../NumberField";
import Select from "../Select";
import Slider from "../Slider";
import Stack from "../Stack";
import Switch from "../Switch";
import TextField from "../TextField";

import "./config-form.css";

const DEFAULT_PARSERS = {
  default: (value) => value,

  number: (value) => (value === "" || value == null ? "" : Number(value)),

  "nullable-number": (value) => (value === "" || value == null ? null : Number(value))
};

const inputRenderer =
  (type) =>
  ({ props, value, change, blur }) => (
    <TextField
      {...props}
      type={type}
      value={value ?? ""}
      onChange={change}
      onBlur={(event) => blur(event?.target?.value ?? value)}
    />
  );

const DEFAULT_RENDERERS = {
  select: ({ props, value, change }) => <Select {...props} value={value ?? ""} onChange={change} />,

  slider: ({ props, value, change }) => <Slider {...props} value={value ?? 0} onChange={change} />,

  text: inputRenderer("text"),

  number: ({ props, value, change, blur }) => (
    <NumberField
      {...props}
      value={value ?? ""}
      onChange={change}
      onBlur={(event) => blur(event?.target?.value ?? value)}
    />
  ),

  readonly: ({ props, value }) => <TextField {...props} value={value ?? ""} readOnly />,

  folder: ({ props, value, change, blur, field, context }) => (
    <FolderField
      {...props}
      value={value ?? ""}
      readOnly={Boolean(field.pick)}
      onChange={change}
      onBlur={(event) => blur(event?.target?.value ?? value)}
      onBrowse={
        field.pick
          ? async () => {
              const nextValue = await field.pick(context, value);
              if (nextValue) {
                change(nextValue);
                blur(nextValue);
              }
            }
          : undefined
      }
    />
  ),

  toggle: ({ props, value, change }) => (
    <Switch {...props} checked={Boolean(value)} onChange={change} />
  ),

  action: ({ props, field, context }) => {
    const pending = field.isPending?.(context) ?? false;

    return (
      <Button
        variant={field.variant ?? "contained"}
        {...props}
        onClick={() => field.run?.(context)}
      >
        {pending ? field.pendingText : (field.idleText ?? field.label)}
      </Button>
    );
  },

  custom: ({ field, context, value }) =>
    field.render?.({
      field,
      context,
      value
    }) ?? null
};

function ConfigField({ field, context, renderers, parsers, columns }) {
  const {
    type,
    name,
    key,

    span = columns,
    advanced: _,

    parse = "default",
    save,

    getValue,
    setValue,
    saveValue,

    getOptions,
    getLabel,

    isVisible,
    isDisabled,
    isPending,

    run,
    render,
    pick,
    getLevel,

    idleText,
    pendingText,

    startIcon: StartIcon,

    options,

    ...uiProps
  } = field;

  if (isVisible?.(context) === false) {
    return null;
  }

  const value = getValue?.(context);

  const parser = parsers[parse] ?? parsers.default;

  const change = (rawValue) => {
    const nextValue = parser(rawValue);

    setValue?.(context, nextValue);

    if (save === "change") {
      saveValue?.(context, nextValue);
    }
  };

  const blur = (rawValue) => {
    if (save !== "blur") {
      return;
    }

    saveValue?.(context, parser(rawValue));
  };

  const resolvedOptions = getOptions?.(context) ?? options;

  const props = {
    ...uiProps,

    disabled: isDisabled?.(context) ?? uiProps.disabled
  };

  if (type === "select") {
    props.options = Array.isArray(resolvedOptions) ? resolvedOptions : [];
  }

  if (StartIcon) {
    props.startIcon = <StartIcon size={16} />;
  }

  if (getLabel) {
    props.label = getLabel({
      ...context,
      value
    });
  }

  const renderer = renderers[type];

  if (!renderer) {
    return null;
  }

  return (
    <div
      className="ui-config-form-field"
      style={{
        "--config-field-span": Math.max(1, Math.min(columns, Number(span) || columns))
      }}
    >
      {renderer({
        props,
        value,
        change,
        blur,
        context,

        field: {
          type,
          name,
          key,

          label: field.label,

          run,
          render,
          pick,
          getLevel,

          isPending,
          isDisabled,

          idleText,
          pendingText
        }
      })}
    </div>
  );
}

export default function ConfigForm({
  fields = [],
  context = {},
  renderers = {},
  parsers = {},
  columns = 12,
  gap = 2,
  className = "",
  sx,
  style
}) {
  const resolvedRenderers = {
    ...DEFAULT_RENDERERS,
    ...renderers
  };

  const resolvedParsers = {
    ...DEFAULT_PARSERS,
    ...parsers
  };

  return (
    <Stack
      className={`ui-config-form ${className}`.trim()}
      sx={{
        "--config-form-columns": columns,
        "--config-form-gap": `var(--space-${gap})`,
        ...sx
      }}
      style={style}
    >
      {fields.map((field, index) => (
        <ConfigField
          key={field.key ?? field.name ?? index}
          field={field}
          context={context}
          renderers={resolvedRenderers}
          parsers={resolvedParsers}
          columns={columns}
        />
      ))}
    </Stack>
  );
}

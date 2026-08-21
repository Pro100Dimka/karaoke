const identity = (value) => value;

export default function RangeInput({
  value,
  onChange = identity,
  onCommit,
  numeric = true,
  commitKeys = ["ArrowLeft", "ArrowRight", "Home", "End"],
  ...props
}) {
  const normalize = (nextValue) => (numeric ? Number(nextValue) : nextValue);
  const change = (event) => onChange(normalize(event.currentTarget.value), event);
  const commit = (event) => onCommit?.(normalize(event.currentTarget.value), event);

  return (
    <input
      {...props}
      type="range"
      value={value}
      onChange={change}
      onPointerUp={onCommit ? commit : undefined}
      onKeyUp={
        onCommit
          ? (event) => {
              if (commitKeys.includes(event.key)) commit(event);
            }
          : undefined
      }
    />
  );
}

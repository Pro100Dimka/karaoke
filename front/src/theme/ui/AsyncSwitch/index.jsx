import Switch from "../Switch";
import useAction from "../_internal/action/useAction";

export default function AsyncSwitch({
  state,
  action,
  disabled = false,
  successDuration = 700,
  errorDuration = 1200,
  onChange,
  onError,
  ...props
}) {
  const asyncAction = useAction({
    action,
    state,
    successDuration,
    errorDuration
  });

  const change = async (next, event) => {
    onChange?.(next, event);
    if (!action) return;

    try {
      await asyncAction.run(next);
    } catch (error) {
      onError?.(error);
    }
  };

  return (
    <Switch
      {...props}
      disabled={disabled || asyncAction.busy}
      data-state={asyncAction.state !== "idle" ? asyncAction.state : undefined}
      aria-busy={asyncAction.busy || undefined}
      onChange={change}
    />
  );
}

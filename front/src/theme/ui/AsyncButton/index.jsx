import Button from "../Button";
import useAction from "../_internal/useAction";
import "./async-button.css";

const TEXT = {
  loading: "Загрузка…",
  success: "Готово",
  error: "Ошибка"
};

export default function AsyncButton({
  action,
  state,
  loadingText = TEXT.loading,
  successText = TEXT.success,
  errorText = TEXT.error,
  successDuration,
  errorDuration,
  progress,
  disabled,
  children,
  onClick,
  onError,
  style,
  ...props
}) {
  const asyncAction = useAction({ action, state, successDuration, errorDuration });
  const text = {
    loading: loadingText,
    success: successText,
    error: errorText
  }[asyncAction.state];

  const click = async event => {
    onClick?.(event);
    if (event.defaultPrevented || !action) return;

    try {
      await asyncAction.run(event);
    } catch (error) {
      onError?.(error);
    }
  };

  return (
    <Button
      {...props}
      disabled={disabled || asyncAction.busy}
      data-state={asyncAction.state !== "idle" ? asyncAction.state : undefined}
      aria-busy={asyncAction.busy || undefined}
      onClick={click}
      style={{
        "--button-progress":
          progress == null ? undefined : `${Math.max(0, Math.min(100, progress))}%`,
        ...style
      }}
    >
      {text ? (
        <>
          <span className="ui-button-base-label">{children}</span>
          <span className="ui-button-status" aria-live="polite">{text}</span>
        </>
      ) : children}
    </Button>
  );
}

"""Shared production device selection and accelerator fallback helpers."""

from __future__ import annotations

from ..runtime import configure_runtime, mark_backend_failed, selected_backend


def select_torch_device(torch, model: str = "fcpe") -> str:
    """Return the registry-selected device; CPU is the universal safe default."""
    plan = configure_runtime(torch_module=torch)
    try:
        cuda_available = bool(torch.cuda.is_available())
    except (AttributeError, RuntimeError):
        cuda_available = False
    if cuda_available != plan.hardware.cuda_available:
        plan = configure_runtime(force=True, torch_module=torch)
    spec = plan.selected.get(model)
    return "cuda:0" if spec is not None and spec.device == "cuda" else "cpu"


def accelerator_failure(error: BaseException) -> bool:
    """Recognize failures for which retrying the same backend cannot help."""
    message = f"{type(error).__name__}: {error}".casefold()
    markers = (
        "cuda",
        "cudnn",
        "cublas",
        "gpu",
        "device-side",
        "out of memory",
        "driver",
        "nvrtc",
    )
    return isinstance(error, (RuntimeError, OSError)) or any(
        marker in message for marker in markers
    )


def fallback_torch_device(model: str, current: str, error: BaseException) -> str | None:
    """Disable a failed CUDA backend and return its registered CPU fallback."""
    if not current.startswith("cuda") or not accelerator_failure(error):
        return None
    spec = selected_backend(model)
    if spec is None:
        return None
    replacement = mark_backend_failed(model, spec.key, error)
    if replacement is not None and replacement.device == "cpu":
        print(
            f"[AI runtime] {model}: {spec.key} failed; retrying with {replacement.key}",
            flush=True,
        )
        return "cpu"
    return None

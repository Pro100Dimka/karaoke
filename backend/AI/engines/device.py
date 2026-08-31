import gc

from ..runtime import selected_backend


def select_torch_device(torch, role="") -> str:
    """Return the device selected by the configured runtime plan for *role*."""
    backend = selected_backend(role)
    if backend is None:
        return "cpu"
    if backend.device == "cuda" and not torch.cuda.is_available():
        return "cpu"
    return backend.device


def release_torch_memory() -> None:
    """Collect discarded models and return their cached CUDA blocks to the driver."""
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            if hasattr(torch.cuda, "ipc_collect"):
                torch.cuda.ipc_collect()
    except (ImportError, RuntimeError):
        pass


def accelerator_failure(_error: BaseException) -> bool:
    return True


def fallback_torch_device(_model: str, current: str, _error: BaseException) -> str | None:
    return "cpu" if current != "cpu" else None

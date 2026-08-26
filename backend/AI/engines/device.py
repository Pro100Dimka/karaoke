import gc


def select_torch_device(torch, _model="") -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


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

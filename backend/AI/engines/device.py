def select_torch_device(torch, _model="") -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def accelerator_failure(_error: BaseException) -> bool:
    return True


def fallback_torch_device(_model: str, current: str, _error: BaseException) -> str | None:
    return "cpu" if current != "cpu" else None

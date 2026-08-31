from AI.engines.separation import _worker_error


def test_worker_error_classifies_accelerator_by_type_or_code_not_message():
    OutOfMemoryError = type("OutOfMemoryError", (RuntimeError,), {"__module__": "torch.cuda"})
    cuda = _worker_error(OutOfMemoryError("allocation failed"), "cuda")
    misleading = _worker_error(RuntimeError("CUDA appears only in text"), "cuda")
    cpu = _worker_error(OutOfMemoryError("allocation failed"), "cpu")

    assert cuda["accelerator"] is True
    assert misleading["accelerator"] is False
    assert cpu["accelerator"] is False

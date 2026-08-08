from app.main import _is_benign_client_disconnect


def test_windows_connection_reset_is_benign():
    error = ConnectionResetError(10054, "client closed the connection")
    error.winerror = 10054

    assert _is_benign_client_disconnect({"exception": error})


def test_programming_error_is_not_hidden():
    assert not _is_benign_client_disconnect({"exception": RuntimeError("boom")})

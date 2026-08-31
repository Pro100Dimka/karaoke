import pytest

from AI.utils.io import read_json


def test_read_json_defaults_only_when_file_is_missing(tmp_path):
    missing = tmp_path / "missing.json"
    assert read_json(missing, default={"missing": True}) == {"missing": True}

    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{broken", encoding="utf-8")
    with pytest.raises(ValueError, match="Invalid JSON file"):
        read_json(corrupt, default={"must": "not hide corruption"})

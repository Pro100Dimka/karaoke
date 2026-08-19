from tests._shared import raises, dump_json

from unittest.mock import Mock

import pytest

from AI.cache import StageCache



def test_cache_loads_only_current_valid_index(tmp_path):
    root = tmp_path / "cache"
    cache = StageCache(root)
    assert cache.index == {"version": cache.INDEX_VERSION, "stages": {}}
    dump_json(cache.index_path, [])
    assert cache._load_index() == {"version": cache.INDEX_VERSION, "stages": {}}
    dump_json(cache.index_path, {"version": cache.INDEX_VERSION, "stages": []})
    assert cache._load_index()["stages"] == {}
    dump_json(cache.index_path, {"version": cache.INDEX_VERSION, "stages": {"a": {}}})
    assert "a" in cache._load_index()["stages"]


def test_file_hash_memoization_and_optional_files(tmp_path):
    cache, source = StageCache(tmp_path / 'cache'), tmp_path / 'source'
    source.write_bytes(b"payload")
    first = cache.file_hash(source, block=2)
    assert (cache.file_hash(source) == first) and (cache.optional_file_hash(None) is None) and (cache.optional_file_hash(tmp_path / 'missing').startswith('missing:')) and (cache.optional_file_hash(source) == first)
    cache._hash_memo.update({(str(i), i, i, i): str(i) for i in range(4097)})
    other = tmp_path / "other"
    other.write_bytes(b"other")
    assert (cache.file_hash(other)) and (len(cache._hash_memo) == 1) and (StageCache.key('stage', {'b': 1, 'a': source}) == StageCache.key('stage', {'a': source, 'b': 1}))


def test_cache_commit_hit_invalidate_round_trip(tmp_path):
    cache, output = StageCache(tmp_path / 'cache'), tmp_path / 'artifact'
    output.write_text("ok")
    validator = Mock()
    cache.commit("pitch", "key", [output])
    assert not cache.hit("pitch", "key", [output], {output: validator})
    validator.assert_not_called()
    assert not cache.hit("pitch", "other", [output])
    cache.invalidate("pitch", "missing")
    assert not cache.hit("pitch", "key", [output])


def test_cache_hit_rejects_malformed_or_changed_outputs(tmp_path):
    cache, output = StageCache(tmp_path / 'cache'), tmp_path / 'artifact'
    output.write_text("ok")
    resolved = str(output.resolve())
    cases = [
        {"key": "key", "outputs": []},
        {"key": "key", "outputs": {}},
        {"key": "key", "outputs": {resolved: []}},
        {"key": "key", "outputs": {resolved: {"size": 99, "sha256": "x"}}},
        {"key": "key", "outputs": {resolved: {"size": 2, "sha256": "x"}}},
    ]
    for entry in cases:
        dump_json(cache.index_path, {"version": cache.INDEX_VERSION, "stages": {"s": entry}})
        assert not cache.hit("s", "key", [output])
    output.unlink()
    dump_json(
        cache.index_path,
        {
            "version": cache.INDEX_VERSION,
            "stages": {"s": {"key": "key", "outputs": {resolved: {}}}},
        },
    )
    assert not cache.hit("s", "key", [output])


def test_cache_hit_swallows_validator_and_filesystem_errors(monkeypatch, tmp_path):
    cache, output = StageCache(tmp_path / 'cache'), tmp_path / 'artifact'
    output.write_text("ok")
    cache.commit("s", "key", [output])
    assert not cache.hit("s", "key", [output], {output: Mock(side_effect=ValueError("bad"))})
    monkeypatch.setattr(cache, "file_hash", Mock(side_effect=OSError("locked")))
    assert not cache.hit("s", "key", [output])


def test_cache_commit_rejects_missing_and_empty_artifacts(tmp_path):
    cache, missing = StageCache(tmp_path / 'cache'), tmp_path / 'missing'
    raises(FileNotFoundError, lambda: cache.commit('s', 'k', [missing]), match='Missing expected stage artifact')
    missing.touch()
    raises(FileNotFoundError, lambda: cache.commit('s', 'k', [missing]), match='Missing expected stage artifact')
    cache.commit("empty", "key")
    assert not cache.hit("empty", "key", [])

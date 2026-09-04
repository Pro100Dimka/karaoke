from AI.cache import StageCache


def test_stage_cache_persists_keys_checks_outputs_and_invalidates(tmp_path):
    output = tmp_path / "result.json"
    output.write_text("{}", encoding="utf-8")
    cache = StageCache(tmp_path / "cache")

    assert not cache.hit("pitch", "key", [output])
    cache.commit("pitch", "key", [output])
    assert cache.hit("pitch", "key", [output])

    reopened = StageCache(tmp_path / "cache")
    assert reopened.key_matches("pitch", "key")
    output.unlink()
    assert not reopened.hit("pitch", "key", [output])
    reopened.invalidate("pitch")
    assert not reopened.key_matches("pitch", "key")

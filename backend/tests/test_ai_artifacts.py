from AI.artifacts import recover_orphaned_backups


def test_recovers_missing_targets_and_removes_stale_backups(tmp_path):
    missing = tmp_path / "lyrics.json"
    missing.with_suffix(".json.bak").write_text("restored", encoding="utf-8")
    existing = tmp_path / "notes.json"
    existing.write_text("current", encoding="utf-8")
    existing.with_suffix(".json.bak").write_text("old", encoding="utf-8")

    assert recover_orphaned_backups(tmp_path) == [missing]
    assert missing.read_text(encoding="utf-8") == "restored"
    assert existing.read_text(encoding="utf-8") == "current"
    assert not list(tmp_path.rglob("*.bak"))

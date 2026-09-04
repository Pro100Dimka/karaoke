import subprocess
from types import SimpleNamespace

import pytest

from tests import fault_injection as fi


def test_fail_write_blocks_writes_but_not_reads(monkeypatch, tmp_path):
    existing = tmp_path / "existing.txt"
    existing.write_text("before")
    fi.fail_write(monkeypatch)
    with pytest.raises(OSError, match="simulated write failure"):
        (tmp_path / "new.txt").open("w")
    assert existing.open("r").read() == "before"


def test_fail_rename_raises_on_rename_and_replace(monkeypatch, tmp_path):
    source = tmp_path / "a.txt"
    source.write_text("x")
    fi.fail_rename(monkeypatch)
    with pytest.raises(OSError, match="simulated rename failure"):
        source.rename(tmp_path / "b.txt")
    with pytest.raises(OSError, match="simulated rename failure"):
        source.replace(tmp_path / "c.txt")


def test_delay_operation_sleeps_before_calling_through(monkeypatch):
    target = SimpleNamespace(work=lambda value: value * 2)
    slept = []
    monkeypatch.setattr(fi.time, "sleep", lambda seconds: slept.append(seconds))
    fi.delay_operation(monkeypatch, target, "work", 0.25)
    assert target.work(3) == 6
    assert slept == [0.25]


def test_kill_child_reports_dead_process(monkeypatch):
    target = SimpleNamespace(spawn=lambda: subprocess.Popen(["true"]))
    fi.kill_child(monkeypatch, target, "spawn", returncode=-9)
    process = target.spawn()
    assert process.poll() == -9
    assert process.wait() == -9
    process.terminate()
    process.kill()


def test_return_corrupt_data_overrides_the_result(monkeypatch):
    target = SimpleNamespace(read=lambda: b"real data")
    fi.return_corrupt_data(monkeypatch, target, "read", b"\x00\x00garbage")
    assert target.read() == b"\x00\x00garbage"


def test_simulate_oom_raises_memory_error(monkeypatch):
    target = SimpleNamespace(allocate=lambda size: bytearray(size))
    fi.simulate_oom(monkeypatch, target, "allocate")
    with pytest.raises(MemoryError):
        target.allocate(1024)


def test_simulate_device_loss_raises_os_error(monkeypatch):
    target = SimpleNamespace(read_frame=lambda: b"samples")
    fi.simulate_device_loss(monkeypatch, target, "read_frame")
    with pytest.raises(OSError, match="simulated device disconnect"):
        target.read_frame()


def test_call_n_times_then_advances_through_each_call_in_order():
    run = fi.call_n_times_then([lambda: "first", lambda: (_ for _ in ()).throw(RuntimeError("second")), lambda: "third"])
    assert run() == "first"
    with pytest.raises(RuntimeError, match="second"):
        run()
    assert run() == "third"
    # Exhausted: keeps repeating the last entry rather than raising IndexError.
    assert run() == "third"

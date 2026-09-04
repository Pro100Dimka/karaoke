from __future__ import annotations

import shutil
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path

MIB = 1024**2
GIB = 1024**3
MIN_SAFETY_BYTES = 256 * MIB
SAFETY_RATIO = 0.10
_lock = threading.RLock()
_reservations: dict[str, tuple[str, int]] = {}


class InsufficientStorageError(Exception):
    def __init__(
        self, operation: str, target: Path, *, required: int, free: int, reclaimable: int
    ) -> None:
        self.operation = operation
        self.target = target
        self.required_bytes = required
        self.free_bytes = free
        self.reclaimable_bytes = reclaimable
        super().__init__(
            f"Insufficient storage for {operation}: required={required}, free={free}, "
            f"reclaimable={reclaimable}, target={target}"
        )

    def payload(self) -> dict[str, object]:
        return {
            "message": str(self),
            "operation": self.operation,
            "target": str(self.target),
            "required_bytes": self.required_bytes,
            "free_bytes": self.free_bytes,
            "reclaimable_bytes": self.reclaimable_bytes,
        }


def _usage_path(target: Path) -> Path:
    current = target.resolve(strict=False)
    while not current.exists() and current != current.parent:
        current = current.parent
    return current


def _volume_key(target: Path) -> str:
    usage_path = _usage_path(target)
    anchor = usage_path.anchor
    return anchor.casefold() if anchor else str(usage_path).casefold()


def _safety_margin(payload_bytes: int) -> int:
    return max(MIN_SAFETY_BYTES, int(max(0, payload_bytes) * SAFETY_RATIO))


@dataclass
class Reservation:
    token: str
    operation: str
    target: Path
    required_bytes: int
    free_bytes: int
    reclaimable_bytes: int
    _released: bool = False

    def consume(self, persisted_bytes: int) -> None:
        """Replace promised bytes with bytes now physically visible to disk_usage."""
        if self._released:
            return
        remaining = max(0, self.required_bytes - max(0, int(persisted_bytes)))
        with _lock:
            current = _reservations.get(self.token)
            if current is not None:
                _reservations[self.token] = (current[0], remaining)

    def release(self) -> None:
        if self._released:
            return
        with _lock:
            _reservations.pop(self.token, None)
        self._released = True

    def __enter__(self) -> Reservation:
        return self

    def __exit__(self, *_args: object) -> None:
        self.release()


def reserve(
    operation: str,
    target: Path,
    payload_bytes: int,
    *,
    reclaimable_bytes: int = 0,
) -> Reservation:
    payload = max(0, int(payload_bytes))
    required = payload + _safety_margin(payload)
    target = target.resolve(strict=False)
    volume = _volume_key(target)
    usage = shutil.disk_usage(_usage_path(target))
    with _lock:
        already_reserved = sum(size for key, size in _reservations.values() if key == volume)
        available = max(0, int(usage.free) - already_reserved)
        reclaimable = max(0, int(reclaimable_bytes))
        if required > available + reclaimable:
            raise InsufficientStorageError(
                operation,
                target,
                required=required,
                free=available,
                reclaimable=reclaimable,
            )
        token = uuid.uuid4().hex
        _reservations[token] = (volume, required)
    return Reservation(token, operation, target, required, available, reclaimable)


def reserve_many(
    requests: list[tuple[str, Path, int]],
) -> list[Reservation]:
    reservations: list[Reservation] = []
    try:
        for operation, target, payload_bytes in requests:
            reservations.append(reserve(operation, target, payload_bytes))
        return reservations
    except BaseException:
        for reservation in reservations:
            reservation.release()
        raise


def release_all(reservations: list[Reservation]) -> None:
    for reservation in reservations:
        reservation.release()


def tree_size(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        try:
            return path.stat().st_size
        except OSError:
            return 0
    total = 0
    for item in path.rglob("*"):
        if not item.is_file():
            continue
        try:
            total += item.stat().st_size
        except OSError:
            continue
    return total


def processing_bytes(source: Path, *, reuse_vocals: bool = False) -> int:
    source_size = tree_size(source)
    # Decode + two stems + transactional output. Compressed inputs can expand
    # substantially, so retain a conservative fixed floor for ordinary songs.
    multiplier = 5 if reuse_vocals else 12
    floor = 512 * MIB if reuse_vocals else 2 * GIB
    return max(floor, source_size * multiplier)


def recording_bytes(sample_rate: int, channels: int, duration_seconds: int) -> int:
    # One PCM_24 WAV. Callers reserve this on both temporary and publish
    # volumes; if they are the same volume the logical reservations add up.
    return max(64 * MIB, max(1, sample_rate) * max(1, channels) * 3 * duration_seconds)


def snapshot() -> dict[str, object]:
    with _lock:
        by_volume: dict[str, int] = {}
        for volume, size in _reservations.values():
            by_volume[volume] = by_volume.get(volume, 0) + size
        return {"count": len(_reservations), "reserved_bytes_by_volume": by_volume}


def capacity(target: Path) -> dict[str, int]:
    target = target.resolve(strict=False)
    volume = _volume_key(target)
    free = int(shutil.disk_usage(_usage_path(target)).free)
    with _lock:
        reserved = sum(size for key, size in _reservations.values() if key == volume)
    return {
        "free_bytes": free,
        "reserved_bytes": reserved,
        "available_bytes": max(0, free - reserved),
    }

"""Transactional deletion for database records backed by files."""

from __future__ import annotations

import logging
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.utils.quarantine import (
    purge_quarantined_paths,
    quarantine_paths,
    restore_quarantined_paths,
)

logger = logging.getLogger(__name__)


def delete_with_files(db: Session, instance: Any, paths: Iterable[Path]) -> None:
    """Delete an ORM record without losing its files when commit fails.

    Files are moved aside before the database transaction and restored on a
    failed commit. Once the commit succeeds, cleanup is best-effort: a failure
    to remove an already quarantined path must not turn a successful database
    deletion into a misleading HTTP 500 response.
    """
    quarantined = quarantine_paths(paths)
    try:
        db.delete(instance)
        db.commit()
    except Exception as exc:
        db.rollback()
        try:
            restore_quarantined_paths(quarantined)
        except Exception as restore_error:  # pragma: no cover - rare OS failure
            exc.add_note(f"Could not restore quarantined files: {restore_error}")
        raise

    try:
        purge_quarantined_paths(quarantined)
    except OSError:
        logger.warning(
            "Database record was deleted, but quarantined files could not be purged",
            exc_info=True,
        )

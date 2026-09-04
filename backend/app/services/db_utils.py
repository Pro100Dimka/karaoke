
from __future__ import annotations

from typing import TypeVar

from sqlalchemy.orm import Session

T = TypeVar("T")


def commit(db: Session) -> None:
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise


def commit_refresh(db: Session, instance: T) -> T:
    commit(db)
    try:
        db.refresh(instance)
    except Exception:
        # commit() already succeeded, so there's no pending write to lose --
        # but db.refresh() issues its own SELECT, which can itself fail (e.g.
        # the row was deleted by a concurrent request between this commit and
        # the refresh) and leaves an un-rolled-back transaction open on the
        # session. Without this, every later use of `db` on this request
        # inherits that broken transaction state instead of a clean one.
        db.rollback()
        raise
    return instance

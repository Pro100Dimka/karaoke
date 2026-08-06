"""Transaction helpers used by application services."""

from __future__ import annotations

from typing import TypeVar

from sqlalchemy.orm import Session

T = TypeVar("T")


def commit(db: Session) -> None:
    """Commit one transaction and leave the session reusable after failure."""
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise


def commit_refresh(db: Session, instance: T) -> T:
    """Commit and refresh an ORM instance with consistent rollback semantics."""
    commit(db)
    db.refresh(instance)
    return instance


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
    db.refresh(instance)
    return instance

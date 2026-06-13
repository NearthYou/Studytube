from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from psycopg import connect
from psycopg.rows import dict_row


ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env", override=False)
load_dotenv(ROOT_DIR.parent / "back" / ".env", override=False)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:1234@localhost:5433/travel_app",
)


class DatabaseClient:
    def __init__(self, dsn: str = DATABASE_URL) -> None:
        self.dsn = dsn

    def fetch_all(
        self,
        query: str,
        params: tuple[Any, ...] = (),
    ) -> list[dict[str, Any]]:
        with connect(self.dsn, row_factory=dict_row) as connection:
            with connection.cursor() as cursor:
                cursor.execute(query, params)
                return [dict(row) for row in cursor.fetchall()]

    def fetch_one(
        self,
        query: str,
        params: tuple[Any, ...] = (),
    ) -> dict[str, Any] | None:
        with connect(self.dsn, row_factory=dict_row) as connection:
            with connection.cursor() as cursor:
                cursor.execute(query, params)
                row = cursor.fetchone()
                return dict(row) if row is not None else None

    def execute(self, query: str, params: tuple[Any, ...] = ()) -> None:
        with connect(self.dsn, row_factory=dict_row) as connection:
            with connection.cursor() as cursor:
                cursor.execute(query, params)
            connection.commit()

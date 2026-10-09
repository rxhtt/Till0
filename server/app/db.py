"""Database connection pool and DDL migration for Till0.

Uses psycopg3 (async) with a connection pool.
Schema is applied at startup via CREATE TABLE IF NOT EXISTS.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import psycopg_pool
from psycopg import AsyncConnection
from psycopg.rows import dict_row


class TrackedAsyncConnectionPool(psycopg_pool.AsyncConnectionPool[AsyncConnection[dict[str, Any]]]):
    """AsyncConnectionPool that instruments simultaneous connection usage."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.active_conns: int = 0
        self.peak_conns: int = 0

    @asynccontextmanager
    async def connection(
        self, timeout: float | None = None
    ) -> AsyncIterator[AsyncConnection[dict[str, Any]]]:
        async with super().connection(timeout=timeout) as conn:
            self.active_conns += 1
            if self.active_conns > self.peak_conns:
                self.peak_conns = self.active_conns
            try:
                yield conn
            finally:
                self.active_conns -= 1


_POOL: TrackedAsyncConnectionPool | None = None

DDL = """
CREATE TABLE IF NOT EXISTS products (
    sku          TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    price_paise  INTEGER NOT NULL CHECK (price_paise >= 0),
    tax_bp       INTEGER NOT NULL DEFAULT 0 CHECK (tax_bp >= 0),
    barcode      TEXT UNIQUE NOT NULL,
    opening_stock INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
    server_seq   BIGSERIAL PRIMARY KEY,
    event_id     TEXT UNIQUE NOT NULL,
    terminal_id  TEXT NOT NULL,
    terminal_seq INTEGER NOT NULL,
    type         TEXT NOT NULL,
    payload      JSONB NOT NULL,
    client_ts    TIMESTAMPTZ NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_balance (
    sku  TEXT PRIMARY KEY REFERENCES products(sku),
    qty  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exceptions (
    id         BIGSERIAL PRIMARY KEY,
    sku        TEXT NOT NULL,
    event_id   TEXT NOT NULL,
    qty_after  INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dead_letters (
    event_id TEXT PRIMARY KEY,
    reason   TEXT NOT NULL,
    raw      JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
    id         BIGSERIAL PRIMARY KEY,
    sku        TEXT NOT NULL,
    qty        INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS server_sequence (
    id          INTEGER PRIMARY KEY,
    current_seq BIGINT NOT NULL
);
INSERT INTO server_sequence (id, current_seq) VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;
"""


async def init_pool() -> None:
    """Create the global async connection pool and apply DDL."""
    global _POOL
    dsn = os.environ.get(
        "DATABASE_URL",
        "postgresql://till0:till0_secret@localhost:5433/till0",
    )
    _POOL = TrackedAsyncConnectionPool(
        conninfo=dsn,
        min_size=2,
        max_size=20,
        kwargs={"row_factory": dict_row, "autocommit": False},
        open=False,
    )
    await _POOL.open()
    async with _POOL.connection() as conn:
        await conn.execute(DDL)
        await conn.execute(
            """
            INSERT INTO server_sequence (id, current_seq)
            VALUES (1, COALESCE((SELECT MAX(server_seq) FROM events), 0))
            ON CONFLICT (id) DO UPDATE
            SET current_seq = GREATEST(
                server_sequence.current_seq,
                COALESCE((SELECT MAX(server_seq) FROM events), 0)
            )
            """
        )
        await conn.commit()


async def close_pool() -> None:
    """Close the global connection pool."""
    global _POOL
    if _POOL is not None:
        await _POOL.close()
        _POOL = None


def get_pool() -> TrackedAsyncConnectionPool:
    """Return the active pool; raises if not initialised."""
    if _POOL is None:
        raise RuntimeError("Database pool not initialised")
    return _POOL

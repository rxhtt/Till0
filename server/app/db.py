"""Database connection pool and DDL migration for Till0.

Uses psycopg3 (async) with a connection pool.
Schema is applied at startup via CREATE TABLE IF NOT EXISTS.
"""

from __future__ import annotations

import os

import psycopg_pool
from psycopg import AsyncConnection
from psycopg.rows import dict_row

_POOL: psycopg_pool.AsyncConnectionPool[AsyncConnection[dict]] | None = None  # type: ignore[type-arg]

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
"""


async def init_pool() -> None:
    """Create the global async connection pool and apply DDL."""
    global _POOL
    dsn = os.environ.get(
        "DATABASE_URL",
        "postgresql://till0:till0_secret@localhost:5433/till0",
    )
    _POOL = psycopg_pool.AsyncConnectionPool(
        conninfo=dsn,
        min_size=2,
        max_size=20,
        kwargs={"row_factory": dict_row, "autocommit": False},
        open=False,
    )
    await _POOL.open()
    async with _POOL.connection() as conn:
        await conn.execute(DDL)


async def close_pool() -> None:
    """Close the global connection pool."""
    global _POOL
    if _POOL is not None:
        await _POOL.close()
        _POOL = None


def get_pool() -> psycopg_pool.AsyncConnectionPool[AsyncConnection[dict]]:  # type: ignore[type-arg]
    """Return the active pool; raises if not initialised."""
    if _POOL is None:
        raise RuntimeError("Database pool not initialised")
    return _POOL

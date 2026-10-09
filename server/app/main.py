"""FastAPI application entry point for Till0 – Task P1.

Endpoints:
  GET  /health
  GET  /catalog
  POST /sync/push
  GET  /sync/pull
  GET  /audit
  GET  /ledger
  POST /admin/reset
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query
from psycopg import AsyncCursor

from server.app.db import close_pool, get_pool, init_pool
from server.app.schemas import (
    AlertOut,
    AuditResponse,
    AuditSkuRow,
    DeadLetterOut,
    ExceptionOut,
    HealthResponse,
    LedgerResponse,
    ProductOut,
    PullResponse,
    PushBatch,
    PushEventResult,
    PushResponse,
    StockSnapshot,
    StoredEvent,
)

# Low-stock threshold (units); crossing downward triggers an alert row.
LOW_STOCK_THRESHOLD: int = int(os.environ.get("LOW_STOCK_THRESHOLD", "5"))

# Admin secret required for POST /admin/reset.
ADMIN_SECRET: str = os.environ.get("ADMIN_SECRET", "till0_admin")


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    """Initialize the DB pool on startup and close it on shutdown."""
    await init_pool()
    yield
    await close_pool()


app = FastAPI(
    title="Till0 POS Server",
    version="0.1.0",
    description="Backend API and sync ledger for Till0 POS.",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_utc() -> datetime:
    return datetime.now(tz=UTC)


def _iso(dt: datetime | None) -> str:
    if dt is None:
        return _now_utc().isoformat()
    return dt.isoformat()


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------


@app.get("/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    """Check API server health status."""
    return HealthResponse(status="ok", version="0.1.0")


# ---------------------------------------------------------------------------
# GET /catalog
# ---------------------------------------------------------------------------


@app.get("/catalog", response_model=list[ProductOut])
async def get_catalog() -> list[ProductOut]:
    """Return all products with current stock balances."""
    pool = get_pool()
    async with pool.connection() as conn:
        rows = await (
            await conn.execute(
                """
                SELECT p.sku, p.name, p.price_paise, p.tax_bp,
                       p.barcode, p.opening_stock,
                       COALESCE(s.qty, p.opening_stock) AS qty
                FROM products p
                LEFT JOIN stock_balance s ON s.sku = p.sku
                ORDER BY p.name
                """
            )
        ).fetchall()
    return [ProductOut(**row) for row in rows]


# ---------------------------------------------------------------------------
# POST /sync/push
# ---------------------------------------------------------------------------


async def _apply_sale(
    cur: AsyncCursor[Any],
    payload: dict[str, Any],
    event_id: str,
    low_stock: int,
) -> None:
    """Apply stock deltas for a SALE_COMPLETED event. Must be inside SAVEPOINT."""
    lines: list[dict[str, Any]] = payload.get("lines", [])
    if not lines:
        return

    # Validate SKUs and qty
    for line in lines:
        sku: str = line["sku"]
        qty: int = int(line["qty"])
        if qty <= 0:
            raise ValueError(f"qty must be > 0 for sku {sku}")

    # Lock stock_balance rows in sorted SKU order to avoid deadlock
    skus_sorted = sorted({line["sku"] for line in lines})

    for sku in skus_sorted:
        await cur.execute(
            "SELECT qty FROM stock_balance WHERE sku = %s FOR UPDATE",
            (sku,),
        )

    # Apply each line
    for line in lines:
        sku = line["sku"]
        qty = int(line["qty"])

        row = await (
            await cur.execute(
                "SELECT qty FROM stock_balance WHERE sku = %s", (sku,)
            )
        ).fetchone()

        if row is None:
            # Bootstrap from opening_stock
            prod = await (
                await cur.execute(
                    "SELECT opening_stock FROM products WHERE sku = %s", (sku,)
                )
            ).fetchone()
            current = prod["opening_stock"] if prod else 0
        else:
            current = row["qty"]

        new_qty = current - qty

        await cur.execute(
            """
            INSERT INTO stock_balance (sku, qty) VALUES (%s, %s)
            ON CONFLICT (sku) DO UPDATE SET qty = EXCLUDED.qty
            """,
            (sku, new_qty),
        )

        # Exception: balance went below 0
        if new_qty < 0:
            await cur.execute(
                "INSERT INTO exceptions (sku, event_id, qty_after) VALUES (%s, %s, %s)",
                (sku, event_id, new_qty),
            )

        # Alert: balance crossed threshold downward (current >= threshold, new < threshold)
        # current > low_stock means it was above; new_qty <= low_stock means it crossed
        if current > low_stock >= new_qty:
            await cur.execute(
                "INSERT INTO alerts (sku, qty) VALUES (%s, %s)",
                (sku, new_qty),
            )


async def _apply_stock_received(
    cur: AsyncCursor[Any],
    payload: dict[str, Any],
    low_stock: int,
) -> None:
    """Apply stock deltas for a STOCK_RECEIVED event. Must be inside SAVEPOINT."""
    lines: list[dict[str, Any]] = payload.get("lines", [])
    if not lines:
        return

    skus_sorted = sorted({line["sku"] for line in lines})
    for sku in skus_sorted:
        await cur.execute(
            "SELECT qty FROM stock_balance WHERE sku = %s FOR UPDATE",
            (sku,),
        )

    for line in lines:
        sku = line["sku"]
        qty = int(line["qty"])
        if qty <= 0:
            raise ValueError(f"qty must be > 0 for sku {sku}")

        row = await (
            await cur.execute(
                "SELECT qty FROM stock_balance WHERE sku = %s", (sku,)
            )
        ).fetchone()
        if row is None:
            prod = await (
                await cur.execute(
                    "SELECT opening_stock FROM products WHERE sku = %s", (sku,)
                )
            ).fetchone()
            current = prod["opening_stock"] if prod else 0
        else:
            current = row["qty"]

        new_qty = current + qty
        await cur.execute(
            """
            INSERT INTO stock_balance (sku, qty) VALUES (%s, %s)
            ON CONFLICT (sku) DO UPDATE SET qty = EXCLUDED.qty
            """,
            (sku, new_qty),
        )

        # Alert clears if balance rises above threshold — nothing needed here
        # (alerts are historical rows, not active flags)


@app.post("/sync/push", response_model=PushResponse)
async def sync_push(batch: PushBatch) -> PushResponse:
    """Accept a batch of up to 50 events from a terminal.

    Per-event SAVEPOINT ensures one bad event cannot block the rest.
    Stock rows are updated in sorted-SKU order to prevent deadlocks.
    """
    pool = get_pool()
    results: list[PushEventResult] = []

    async with pool.connection() as conn:
        for ev in batch.events:
            # Each event gets its own SAVEPOINT
            sp = f"sp_{ev.event_id.replace('-', '_')}"
            try:
                await conn.execute(f"SAVEPOINT {sp}")

                # Validate payload structure first
                ev_type = ev.type
                payload: dict[str, Any] = dict(ev.payload)

                if ev_type in ("SALE_COMPLETED", "STOCK_RECEIVED") and "lines" not in payload:
                    raise ValueError(f"{ev_type} requires 'lines'")

                cur = conn.cursor()

                # Try to insert the event (UNIQUE constraint on event_id)
                rows = await (
                    await cur.execute(
                        """
                        INSERT INTO events
                            (event_id, terminal_id, terminal_seq, type, payload, client_ts)
                        VALUES (%s, %s, %s, %s, %s::jsonb, %s)
                        ON CONFLICT (event_id) DO NOTHING
                        RETURNING server_seq
                        """,
                        (
                            ev.event_id,
                            ev.terminal_id,
                            ev.terminal_seq,
                            ev.type,
                            json.dumps(payload),
                            ev.client_ts,
                        ),
                    )
                ).fetchone()

                if rows is None:
                    # Duplicate — event_id already in DB
                    await conn.execute(f"RELEASE SAVEPOINT {sp}")
                    results.append(
                        PushEventResult(
                            event_id=ev.event_id,
                            status="duplicate",
                            server_seq=None,
                        )
                    )
                    continue

                server_seq: int = rows["server_seq"]

                # Apply stock deltas for newly inserted events only
                if ev_type == "SALE_COMPLETED":
                    await _apply_sale(cur, payload, ev.event_id, LOW_STOCK_THRESHOLD)
                elif ev_type == "STOCK_RECEIVED":
                    await _apply_stock_received(cur, payload, LOW_STOCK_THRESHOLD)

                await conn.execute(f"RELEASE SAVEPOINT {sp}")
                results.append(
                    PushEventResult(
                        event_id=ev.event_id,
                        status="applied",
                        server_seq=server_seq,
                    )
                )

            except Exception as exc:
                await conn.execute(f"ROLLBACK TO SAVEPOINT {sp}")
                await conn.execute(f"RELEASE SAVEPOINT {sp}")
                with suppress(Exception):
                    await conn.execute(
                        """
                        INSERT INTO dead_letters (event_id, reason, raw)
                        VALUES (%s, %s, %s::jsonb)
                        ON CONFLICT (event_id) DO NOTHING
                        """,
                        (
                            ev.event_id,
                            str(exc)[:500],
                            json.dumps(ev.model_dump()),
                        ),
                    )
                results.append(
                    PushEventResult(
                        event_id=ev.event_id,
                        status="rejected",
                        server_seq=None,
                    )
                )

        await conn.commit()

    return PushResponse(results=results)


# ---------------------------------------------------------------------------
# GET /sync/pull
# ---------------------------------------------------------------------------


@app.get("/sync/pull", response_model=PullResponse)
async def sync_pull(
    since: int = Query(default=0, ge=0, description="Return events with server_seq > since"),
    terminal_id: str = Query(default="", description="Calling terminal ID"),
) -> PullResponse:
    """Return events from other terminals since `since`, plus a stock snapshot."""
    pool = get_pool()
    async with pool.connection() as conn:
        # Events from OTHER terminals (or all if terminal_id not specified)
        if terminal_id:
            ev_rows = await (
                await conn.execute(
                    """
                    SELECT server_seq, event_id, terminal_id, terminal_seq,
                           type, payload, client_ts, received_at
                    FROM events
                    WHERE server_seq > %s AND terminal_id != %s
                    ORDER BY server_seq
                    """,
                    (since, terminal_id),
                )
            ).fetchall()
            # own applied ids for the calling terminal
            own_rows = await (
                await conn.execute(
                    """
                    SELECT event_id FROM events
                    WHERE terminal_id = %s AND server_seq > %s
                    ORDER BY server_seq
                    """,
                    (terminal_id, since),
                )
            ).fetchall()
            own_applied_ids = [r["event_id"] for r in own_rows]
        else:
            ev_rows = await (
                await conn.execute(
                    """
                    SELECT server_seq, event_id, terminal_id, terminal_seq,
                           type, payload, client_ts, received_at
                    FROM events
                    WHERE server_seq > %s
                    ORDER BY server_seq
                    """,
                    (since,),
                )
            ).fetchall()
            own_applied_ids = []

        # Current stock snapshot
        bal_rows = await (
            await conn.execute(
                """
                SELECT p.sku,
                       COALESCE(s.qty, p.opening_stock) AS qty
                FROM products p
                LEFT JOIN stock_balance s ON s.sku = p.sku
                ORDER BY p.sku
                """
            )
        ).fetchall()

        # as_of = max server_seq in DB
        seq_row = await (
            await conn.execute("SELECT COALESCE(MAX(server_seq), 0) AS mx FROM events")
        ).fetchone()
        as_of: int = seq_row["mx"] if seq_row else 0

    events: list[StoredEvent] = [
        StoredEvent(
            server_seq=r["server_seq"],
            event_id=r["event_id"],
            terminal_id=r["terminal_id"],
            terminal_seq=r["terminal_seq"],
            type=r["type"],
            payload=dict(r["payload"]),
            client_ts=_iso(r["client_ts"]),
            received_at=_iso(r["received_at"]),
        )
        for r in ev_rows
    ]
    balances = [StockSnapshot(sku=r["sku"], qty=r["qty"]) for r in bal_rows]

    return PullResponse(
        events=events,
        balances=balances,
        as_of_server_seq=as_of,
        own_applied_ids=own_applied_ids,
    )


# ---------------------------------------------------------------------------
# GET /audit
# ---------------------------------------------------------------------------


@app.get("/audit", response_model=AuditResponse)
async def get_audit() -> AuditResponse:
    """Recompute balances from events and verify conservation.

    Checks:
    - opening_stock - sold + received == stored balance for every SKU
    - No duplicate event_id (should never happen given UNIQUE constraint)
    - No gaps in server_seq sequence
    """
    pool = get_pool()
    async with pool.connection() as conn:
        # All events
        ev_rows = await (
            await conn.execute(
                "SELECT server_seq, event_id, type, payload FROM events ORDER BY server_seq"
            )
        ).fetchall()

        # Products
        prod_rows = await (
            await conn.execute(
                "SELECT sku, opening_stock FROM products"
            )
        ).fetchall()

        # Stored balances
        bal_rows = await (
            await conn.execute(
                "SELECT sku, qty FROM stock_balance"
            )
        ).fetchall()

    stored_balance: dict[str, int] = {r["sku"]: r["qty"] for r in bal_rows}
    opening: dict[str, int] = {r["sku"]: r["opening_stock"] for r in prod_rows}

    # Recompute sold and received from events
    sold: dict[str, int] = {}
    received: dict[str, int] = {}
    seen_ids: dict[str, int] = {}
    duplicate_ids: list[str] = []

    for ev in ev_rows:
        eid: str = ev["event_id"]
        seq: int = ev["server_seq"]
        if eid in seen_ids:
            duplicate_ids.append(eid)
        else:
            seen_ids[eid] = seq

        payload: dict[str, Any] = dict(ev["payload"])
        if ev["type"] == "SALE_COMPLETED":
            for line in payload.get("lines", []):
                sku: str = line["sku"]
                sold[sku] = sold.get(sku, 0) + int(line["qty"])
        elif ev["type"] == "STOCK_RECEIVED":
            for line in payload.get("lines", []):
                sku = line["sku"]
                received[sku] = received.get(sku, 0) + int(line["qty"])

    # Check seq gaps
    seqs = sorted(seen_ids.values())
    gap_ids: list[int] = []
    for i in range(1, len(seqs)):
        if seqs[i] != seqs[i - 1] + 1:
            for missing in range(seqs[i - 1] + 1, seqs[i]):
                gap_ids.append(missing)

    # Per-SKU audit
    sku_rows: list[AuditSkuRow] = []
    overall_ok = True
    for sku in sorted(opening.keys()):
        op = opening[sku]
        sl = sold.get(sku, 0)
        rc = received.get(sku, 0)
        computed = op - sl + rc
        stored = stored_balance.get(sku, op)
        ok = computed == stored
        if not ok:
            overall_ok = False
        sku_rows.append(
            AuditSkuRow(
                sku=sku,
                opening=op,
                sold=sl,
                received=rc,
                computed_balance=computed,
                stored_balance=stored,
                ok=ok,
            )
        )

    status: str = (
        "PASS"
        if (overall_ok and not duplicate_ids and not gap_ids)
        else "FAIL"
    )

    return AuditResponse(
        status=status,  # type: ignore[arg-type]
        duplicate_event_ids=duplicate_ids,
        seq_gaps=gap_ids,
        skus=sku_rows,
    )


# ---------------------------------------------------------------------------
# GET /ledger
# ---------------------------------------------------------------------------


@app.get("/ledger", response_model=LedgerResponse)
async def get_ledger() -> LedgerResponse:
    """Compact state snapshot for the Stage panel."""
    pool = get_pool()
    async with pool.connection() as conn:
        ev_count_row = await (
            await conn.execute("SELECT COUNT(*) AS cnt FROM events")
        ).fetchone()
        event_count: int = ev_count_row["cnt"] if ev_count_row else 0

        dl_count_row = await (
            await conn.execute("SELECT COUNT(*) AS cnt FROM dead_letters")
        ).fetchone()
        duplicates_rejected: int = dl_count_row["cnt"] if dl_count_row else 0

        bal_rows = await (
            await conn.execute(
                """
                SELECT p.sku, COALESCE(s.qty, p.opening_stock) AS qty
                FROM products p
                LEFT JOIN stock_balance s ON s.sku = p.sku
                ORDER BY p.sku
                """
            )
        ).fetchall()

        exc_rows = await (
            await conn.execute(
                "SELECT id, sku, event_id, qty_after, created_at FROM exceptions ORDER BY id"
            )
        ).fetchall()

        dl_rows = await (
            await conn.execute(
                "SELECT event_id, reason FROM dead_letters ORDER BY event_id"
            )
        ).fetchall()

        alert_rows = await (
            await conn.execute(
                "SELECT id, sku, qty, created_at FROM alerts WHERE delivered = FALSE ORDER BY id"
            )
        ).fetchall()

    return LedgerResponse(
        event_count=event_count,
        duplicates_rejected=duplicates_rejected,
        balances=[StockSnapshot(sku=r["sku"], qty=r["qty"]) for r in bal_rows],
        exceptions=[
            ExceptionOut(
                id=r["id"],
                sku=r["sku"],
                event_id=r["event_id"],
                qty_after=r["qty_after"],
                created_at=_iso(r["created_at"]),
            )
            for r in exc_rows
        ],
        dead_letters=[
            DeadLetterOut(event_id=r["event_id"], reason=r["reason"])
            for r in dl_rows
        ],
        alerts=[
            AlertOut(
                id=r["id"],
                sku=r["sku"],
                qty=r["qty"],
                created_at=_iso(r["created_at"]),
            )
            for r in alert_rows
        ],
    )


# ---------------------------------------------------------------------------
# POST /admin/reset
# ---------------------------------------------------------------------------


@app.post("/admin/reset", status_code=204)
async def admin_reset(
    x_admin: str = Header(alias="X-Admin"),
) -> None:
    """Truncate all data tables (demo only). Requires X-Admin header."""
    if x_admin != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")

    pool = get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            """
            TRUNCATE alerts, dead_letters, exceptions,
                     stock_balance, events
            RESTART IDENTITY CASCADE
            """
        )
        await conn.commit()

"""Pytest suite for Till0 P1 sync API – tests a through f.

Tests run against a live PostgreSQL instance (localhost:5433) via the
ASGI test client (httpx + ASGITransport).  Each test gets a clean DB
via the `db_reset` fixture.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import os
import pathlib
import random
import sys
import uuid
from collections.abc import AsyncIterator
from typing import Any

import psycopg
import pytest
import uvicorn
from httpx import ASGITransport, AsyncClient

from server.app.db import DDL, close_pool, get_pool, init_pool
from server.app.main import app

# ---------------------------------------------------------------------------
# DSN – falls back to local dev defaults
# ---------------------------------------------------------------------------

DSN: str = os.environ.get(
    "DATABASE_URL",
    "postgresql://till0:till0_secret@localhost:5433/till0",
)

ADMIN_SECRET: str = os.environ.get("ADMIN_SECRET", "till0_admin")


# ---------------------------------------------------------------------------
# Uvicorn Background Server for Real Overlapping TCP Concurrency
# ---------------------------------------------------------------------------


class UvicornTestServer:
    """Manages a background uvicorn server for real concurrent TCP socket requests."""

    def __init__(self, port: int = 8910) -> None:
        self.port = port
        self.config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            log_level="error",
            lifespan="off",
        )
        self.server = uvicorn.Server(self.config)
        self.task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self.task = asyncio.create_task(self.server.serve())
        async with AsyncClient(base_url=f"http://127.0.0.1:{self.port}") as c:
            for _ in range(50):
                try:
                    r = await c.get("/health")
                    if r.status_code == 200:
                        return
                except Exception:
                    await asyncio.sleep(0.05)
        raise RuntimeError("Uvicorn test server failed to start")

    async def stop(self) -> None:
        self.server.should_exit = True
        if self.task:
            await self.task


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _uid() -> str:
    return str(uuid.uuid4())


def _sale_event(
    terminal_id: str = "T1",
    terminal_seq: int = 1,
    sku: str = "SKU001",
    qty: int = 1,
    price_paise: int = 28900,
    event_id: str | None = None,
) -> dict[str, Any]:
    return {
        "event_id": event_id or _uid(),
        "terminal_id": terminal_id,
        "terminal_seq": terminal_seq,
        "type": "SALE_COMPLETED",
        "payload": {
            "lines": [{"sku": sku, "qty": qty, "price_paise": price_paise}],
            "tender": "CASH",
            "total_paise": price_paise * qty,
            "receipt_no": f"R{terminal_seq:06d}",
        },
        "client_ts": "2026-01-01T00:00:00+00:00",
    }


async def _push(client: AsyncClient, events: list[dict[str, Any]]) -> dict[str, Any]:
    resp = await client.post("/sync/push", json={"events": events})
    assert resp.status_code == 200, resp.text
    res: dict[str, Any] = resp.json()
    return res


async def _reset_db(client: AsyncClient) -> None:
    resp = await client.post("/admin/reset", headers={"X-Admin": ADMIN_SECRET})
    assert resp.status_code == 204, resp.text


def _run_seed() -> None:
    scripts_dir = str(pathlib.Path(__file__).parents[2] / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    seed_mod = importlib.import_module("seed")
    seed_mod.seed(DSN)


async def _seed_db() -> None:
    """Apply DDL and seed products for tests (idempotent)."""
    with psycopg.connect(DSN, autocommit=False) as conn:
        conn.execute(DDL)
        conn.commit()
    _run_seed()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
async def seeded_app() -> AsyncIterator[None]:
    """One-time DB setup: apply DDL + seed products and initialize connection pool."""
    async with asyncio.timeout(30):
        await _seed_db()
        await init_pool()
    yield
    await close_pool()


@pytest.fixture
async def client(seeded_app: None) -> AsyncIterator[AsyncClient]:
    """Fresh ASGI client."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac


@pytest.fixture(autouse=True)
async def db_reset(client: AsyncClient) -> None:
    """Reset DB and reseed products before each test."""
    await _reset_db(client)
    _run_seed()


# ---------------------------------------------------------------------------
# (a) 50 concurrent duplicate pushes apply exactly once
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_concurrent_duplicate_apply_once(client: AsyncClient) -> None:
    """50 concurrent pushes of the same event_id apply exactly once.

    Runs against uvicorn over TCP to guarantee true concurrency, asserts peak
    in-flight simultaneous requests is at least 20, and logs peak connections.
    """
    server = UvicornTestServer(port=8910)
    await server.start()

    pool = get_pool()
    assert pool.max_size >= 20, f"Expected pool max_size >= 20, got {pool.max_size}"
    pool.peak_conns = 0

    event = _sale_event(sku="SKU001", qty=1)
    eid = event["event_id"]

    in_flight = 0
    peak_in_flight = 0
    lock = asyncio.Lock()

    try:
        async with AsyncClient(
            base_url=f"http://127.0.0.1:{server.port}",
            limits=__import__("httpx").Limits(
                max_connections=100, max_keepalive_connections=50
            ),
        ) as tcp_client:
            async def push_one() -> dict[str, Any]:
                nonlocal in_flight, peak_in_flight
                async with lock:
                    in_flight += 1
                    if in_flight > peak_in_flight:
                        peak_in_flight = in_flight
                try:
                    return await _push(tcp_client, [event])
                finally:
                    async with lock:
                        in_flight -= 1

            results = await asyncio.gather(*[push_one() for _ in range(50)])
    finally:
        await server.stop()

    print(
        f"\n[test_a] Peak simultaneous in-flight requests: {peak_in_flight} | "
        f"Peak simultaneous DB connections: {pool.peak_conns} (pool max_size: {pool.max_size})"
    )
    assert peak_in_flight >= 20, (
        f"Expected peak simultaneous in-flight requests >= 20, got {peak_in_flight}"
    )

    applied = [
        r["results"][0]
        for r in results
        if r["results"][0]["status"] == "applied"
    ]
    duplicate = [
        r["results"][0]
        for r in results
        if r["results"][0]["status"] == "duplicate"
    ]

    assert len(applied) == 1, f"Expected exactly 1 applied, got {len(applied)}"
    assert len(duplicate) == 49, f"Expected 49 duplicates, got {len(duplicate)}"
    assert all(r["event_id"] == eid for r in applied + duplicate)

    # Verify stock decremented exactly once
    catalog = (await client.get("/catalog")).json()
    sku001 = next(p for p in catalog if p["sku"] == "SKU001")
    assert sku001["qty"] == sku001["opening_stock"] - 1


# ---------------------------------------------------------------------------
# (b) Two terminals sell the last unit concurrently → balance -1 + one exception
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_b_concurrent_sell_last_unit(client: AsyncClient) -> None:
    """Two terminals sell the last unit simultaneously; one exception row is created."""
    # First bring stock down to exactly 1
    catalog = (await client.get("/catalog")).json()
    sku001 = next(p for p in catalog if p["sku"] == "SKU001")
    opening = sku001["opening_stock"]

    # Sell down to 1
    if opening > 1:
        drain_qty = opening - 1
        await _push(client, [_sale_event(sku="SKU001", qty=drain_qty, event_id=_uid())])

    # Verify balance is 1
    catalog = (await client.get("/catalog")).json()
    sku001 = next(p for p in catalog if p["sku"] == "SKU001")
    assert sku001["qty"] == 1, f"Expected qty=1, got {sku001['qty']}"

    ev_t1 = _sale_event(terminal_id="T1", sku="SKU001", qty=1, event_id=_uid())
    ev_t2 = _sale_event(terminal_id="T2", sku="SKU001", qty=1, event_id=_uid())

    t1_resp, t2_resp = await asyncio.gather(
        _push(client, [ev_t1]),
        _push(client, [ev_t2]),
    )

    statuses = {
        t1_resp["results"][0]["status"],
        t2_resp["results"][0]["status"],
    }
    assert "applied" in statuses, "At least one sale must be applied"

    # Balance must be -1
    catalog = (await client.get("/catalog")).json()
    sku001 = next(p for p in catalog if p["sku"] == "SKU001")
    assert sku001["qty"] == -1, f"Expected qty=-1, got {sku001['qty']}"

    # Must have at least one exception row for SKU001
    ledger = (await client.get("/ledger")).json()
    exc_skus = [e["sku"] for e in ledger["exceptions"]]
    assert "SKU001" in exc_skus, "Expected exception for SKU001"


# ---------------------------------------------------------------------------
# (c) Malformed event in a batch does not block others
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_c_malformed_event_does_not_block(client: AsyncClient) -> None:
    """A structurally invalid event is rejected; the others in the batch are applied."""
    good1 = _sale_event(sku="SKU001", qty=1, event_id=_uid())
    good2 = _sale_event(sku="SKU002", qty=1, event_id=_uid())
    bad = {
        "event_id": _uid(),
        "terminal_id": "T1",
        "terminal_seq": 999,
        "type": "SALE_COMPLETED",
        "payload": {"lines": [{"sku": "SKU-NONEXISTENT", "qty": -999}]},  # bad qty
        "client_ts": "not-a-date",
    }

    result = await _push(client, [good1, bad, good2])
    statuses = {r["event_id"]: r["status"] for r in result["results"]}

    assert statuses[good1["event_id"]] == "applied", "good1 must be applied"
    assert statuses[good2["event_id"]] == "applied", "good2 must be applied"
    assert statuses[bad["event_id"]] == "rejected", "bad event must be rejected"


# ---------------------------------------------------------------------------
# (d) Audit passes after a mixed random workload
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_d_audit_passes_after_workload(client: AsyncClient) -> None:
    """After random SALE + STOCK_RECEIVED events, GET /audit returns PASS."""
    catalog = (await client.get("/catalog")).json()
    skus = [p["sku"] for p in catalog]

    rng = random.Random(42)
    events: list[dict[str, Any]] = []

    for i in range(30):
        sku = rng.choice(skus)
        ev_type = rng.choice(["SALE_COMPLETED", "STOCK_RECEIVED"])

        if ev_type == "SALE_COMPLETED":
            events.append(
                {
                    "event_id": _uid(),
                    "terminal_id": rng.choice(["T1", "T2"]),
                    "terminal_seq": i,
                    "type": "SALE_COMPLETED",
                    "payload": {
                        "lines": [{"sku": sku, "qty": 1, "price_paise": 1000}],
                        "tender": "CASH",
                        "total_paise": 1000,
                        "receipt_no": f"R{i:06d}",
                    },
                    "client_ts": "2026-01-01T00:00:00+00:00",
                }
            )
        else:
            events.append(
                {
                    "event_id": _uid(),
                    "terminal_id": "T1",
                    "terminal_seq": i,
                    "type": "STOCK_RECEIVED",
                    "payload": {"lines": [{"sku": sku, "qty": 10}]},
                    "client_ts": "2026-01-01T00:00:00+00:00",
                }
            )

    # Push in batches of 10
    for i in range(0, len(events), 10):
        await _push(client, events[i : i + 10])

    audit = (await client.get("/audit")).json()
    assert audit["status"] == "PASS", json.dumps(audit, indent=2)


# ---------------------------------------------------------------------------
# (e) Pull pagination has no gaps or repeats
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_e_pull_pagination_no_gaps(client: AsyncClient) -> None:
    """Paginating through /sync/pull with increasing `since` yields no gaps or repeats."""
    # Push 25 events total
    events = [_sale_event(sku="SKU001", qty=1, event_id=_uid()) for _ in range(25)]
    for i in range(0, 25, 10):
        await _push(client, events[i : i + 10])

    # Pull page by page (page size = 5 via since cursor)
    seen_seqs: list[int] = []
    since = 0

    while True:
        resp = await client.get(f"/sync/pull?since={since}")
        assert resp.status_code == 200
        data = resp.json()
        batch = data["events"]
        if not batch:
            break
        batch_seqs = [e["server_seq"] for e in batch]
        # Check no duplicates within this page
        assert len(batch_seqs) == len(set(batch_seqs)), "Duplicates within page"
        # Check no overlap with previously seen
        overlap = set(batch_seqs) & set(seen_seqs)
        assert not overlap, f"Repeated seqs across pages: {overlap}"
        seen_seqs.extend(batch_seqs)
        since = data["as_of_server_seq"]
        if since >= data["as_of_server_seq"]:
            break  # no new events

    # All 25 events must appear
    assert len(seen_seqs) == 25, f"Expected 25 events, got {len(seen_seqs)}"
    # Must be consecutive (no gaps)
    sorted_seqs = sorted(seen_seqs)
    for i in range(1, len(sorted_seqs)):
        assert sorted_seqs[i] == sorted_seqs[i - 1] + 1, (
            f"Gap between {sorted_seqs[i - 1]} and {sorted_seqs[i]}"
        )


# ---------------------------------------------------------------------------
# (f) 200 concurrent pushes from 4 terminals, overlapping SKUs: no deadlock, audit PASS
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_f_concurrent_multi_terminal_no_deadlock(client: AsyncClient) -> None:
    """200 concurrent pushes across 4 terminals with overlapping SKUs.

    Expected: no deadlock (all return 200), audit PASS.
    """
    terminals = ["T1", "T2", "T3", "T4"]
    skus = ["SKU001", "SKU002", "SKU003"]
    rng = random.Random(99)

    events: list[dict[str, Any]] = []
    for i in range(200):
        t = terminals[i % 4]
        sku = rng.choice(skus)
        events.append(
            {
                "event_id": _uid(),
                "terminal_id": t,
                "terminal_seq": i,
                "type": "SALE_COMPLETED",
                "payload": {
                    "lines": [{"sku": sku, "qty": 1, "price_paise": 1000}],
                    "tender": "CASH",
                    "total_paise": 1000,
                    "receipt_no": f"R{i:06d}",
                },
                "client_ts": "2026-01-01T00:00:00+00:00",
            }
        )

    # Push all 200 concurrently in batches of 1 each (max concurrency stress)
    server = UvicornTestServer(port=8911)
    await server.start()

    pool = get_pool()
    assert pool.max_size >= 20, f"Expected pool max_size >= 20, got {pool.max_size}"
    pool.peak_conns = 0

    in_flight = 0
    peak_in_flight = 0
    lock = asyncio.Lock()

    try:
        async with AsyncClient(
            base_url=f"http://127.0.0.1:{server.port}",
            limits=__import__("httpx").Limits(
                max_connections=250, max_keepalive_connections=250
            ),
        ) as tcp_client:
            async def push_one(ev: dict[str, Any]) -> dict[str, Any]:
                nonlocal in_flight, peak_in_flight
                async with lock:
                    in_flight += 1
                    if in_flight > peak_in_flight:
                        peak_in_flight = in_flight
                try:
                    return await _push(tcp_client, [ev])
                finally:
                    async with lock:
                        in_flight -= 1

            results = await asyncio.gather(*[push_one(ev) for ev in events])
    finally:
        await server.stop()

    print(
        f"\n[test_f] Peak simultaneous in-flight requests: {peak_in_flight} | "
        f"Peak simultaneous DB connections: {pool.peak_conns} (pool max_size: {pool.max_size})"
    )
    assert peak_in_flight >= 20, (
        f"Expected peak simultaneous in-flight requests >= 20, got {peak_in_flight}"
    )

    # All 200 requests must get a 200 response (no crashes/deadlocks)
    for result in results:
        assert "results" in result, f"Unexpected response: {result}"
        assert result["results"][0]["status"] in ("applied", "duplicate", "rejected")

    # Audit must pass (conservation)
    audit = (await client.get("/audit")).json()
    assert audit["status"] == "PASS", json.dumps(audit, indent=2)


# ---------------------------------------------------------------------------
# Sequence integrity: duplicates + rolled back savepoint must not create gaps
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sequence_integrity_with_duplicates_and_rollback(client: AsyncClient) -> None:
    """Push 50 duplicates and a malformed event; subsequent audit must pass with no seq gaps."""
    # 1. Push a valid initial event
    ev1 = _sale_event(terminal_id="T1", terminal_seq=1, sku="SKU001", qty=1, event_id=_uid())
    r1 = await _push(client, [ev1])
    assert r1["results"][0]["status"] == "applied"
    first_seq = r1["results"][0]["server_seq"]
    assert first_seq is not None

    # 2. Push 50 duplicates of ev1
    async def push_dup() -> dict[str, Any]:
        return await _push(client, [ev1])

    dup_results = await asyncio.gather(*[push_dup() for _ in range(50)])
    assert all(r["results"][0]["status"] == "duplicate" for r in dup_results)

    # 3. Push a malformed event whose savepoint rolls back (negative qty fails validation)
    bad_ev = {
        "event_id": _uid(),
        "terminal_id": "T1",
        "terminal_seq": 999,
        "type": "SALE_COMPLETED",
        "payload": {"lines": [{"sku": "SKU001", "qty": -5}]},
        "client_ts": "2026-01-01T00:00:00+00:00",
    }
    r_bad = await _push(client, [bad_ev])
    assert r_bad["results"][0]["status"] == "rejected"
    assert r_bad["results"][0]["server_seq"] is None

    # 4. Push another valid event
    ev2 = _sale_event(terminal_id="T1", terminal_seq=2, sku="SKU002", qty=1, event_id=_uid())
    r2 = await _push(client, [ev2])
    assert r2["results"][0]["status"] == "applied"

    # 5. Run audit - must PASS with gap check intact
    audit = (await client.get("/audit")).json()
    assert audit["status"] == "PASS", f"Audit failed: {json.dumps(audit, indent=2)}"
    assert audit["seq_gaps"] == [], f"Found sequence gaps: {audit['seq_gaps']}"
    assert audit["duplicate_event_ids"] == []


# ---------------------------------------------------------------------------
# Pull cursor race: concurrent pushes with concurrent pull pagination
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pull_cursor_race(client: AsyncClient) -> None:
    """Concurrent pushes while a puller repeatedly calls /sync/pull using cursor.

    After quiescence, all events from other terminals must be pulled:
    no skips, no repeats.
    """
    num_events = 40
    events = [
        _sale_event(terminal_id="T1", terminal_seq=i + 1, sku="SKU001", qty=1, event_id=_uid())
        for i in range(num_events)
    ]
    expected_ids = {e["event_id"] for e in events}

    pulled_events: list[dict[str, Any]] = []
    pull_cursor = 0
    stop_pulling = False

    async def pull_worker() -> None:
        nonlocal pull_cursor
        while not stop_pulling:
            resp = await client.get(f"/sync/pull?since={pull_cursor}&terminal_id=T2")
            if resp.status_code == 200:
                data = resp.json()
                evs = data["events"]
                pulled_events.extend(evs)
                pull_cursor = data["as_of_server_seq"]
            await asyncio.sleep(0.01)

    pull_task = asyncio.create_task(pull_worker())

    # Concurrent pushes from T1
    async def push_one(ev: dict[str, Any]) -> dict[str, Any]:
        return await _push(client, [ev])

    await asyncio.gather(*[push_one(ev) for ev in events])

    # Allow puller to drain up to quiescence
    await asyncio.sleep(0.1)
    stop_pulling = True
    await pull_task

    # Final pull to ensure everything up to latest server_seq is pulled
    final_resp = await client.get(f"/sync/pull?since={pull_cursor}&terminal_id=T2")
    assert final_resp.status_code == 200
    pulled_events.extend(final_resp.json()["events"])

    pulled_ids = [e["event_id"] for e in pulled_events]
    pulled_seqs = [e["server_seq"] for e in pulled_events]

    # No repeats
    assert len(pulled_ids) == len(set(pulled_ids)), (
        f"Repeats detected: {len(pulled_ids)} vs {len(set(pulled_ids))}"
    )

    # No skips: all expected events are pulled
    assert set(pulled_ids) == expected_ids, (
        f"Mismatch in pulled IDs: missing {expected_ids - set(pulled_ids)}"
    )

    # Monotonic gapless sequence
    assert sorted(pulled_seqs) == pulled_seqs, "Pulled server_seqs are not strictly monotonic"
    for i in range(1, len(pulled_seqs)):
        assert pulled_seqs[i] == pulled_seqs[i - 1] + 1, (
            f"Gap between {pulled_seqs[i - 1]} and {pulled_seqs[i]}"
        )


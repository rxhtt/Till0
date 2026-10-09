"""Tests for POST /admin/reset endpoint.

Verifies:
- Missing X-Admin header returns 403 (not 422).
- Wrong X-Admin header returns 403.
- Correct X-Admin header returns 204.
- When ADMIN_SECRET is unset or empty, /admin/reset always returns 403.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from server.app.db import close_pool, init_pool
from server.app.main import app


@pytest.fixture(scope="session")
async def seeded_app() -> AsyncIterator[None]:
    """Initialize DB connection pool for admin tests."""
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


@pytest.mark.asyncio
async def test_admin_reset_missing_header(client: AsyncClient) -> None:
    """Missing X-Admin header must return 403."""
    resp = await client.post("/admin/reset")
    assert resp.status_code == 403, (
        f"Expected 403 for missing header, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_admin_reset_wrong_header(client: AsyncClient) -> None:
    """Wrong X-Admin header must return 403."""
    resp = await client.post("/admin/reset", headers={"X-Admin": "wrong_secret_12345"})
    assert resp.status_code == 403, (
        f"Expected 403 for wrong header, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_admin_reset_correct_header(client: AsyncClient) -> None:
    """Correct X-Admin header must return 204."""
    admin_secret = os.environ.get("ADMIN_SECRET", "till0_admin")
    resp = await client.post("/admin/reset", headers={"X-Admin": admin_secret})
    assert resp.status_code == 204, (
        f"Expected 204 for correct header, got {resp.status_code}: {resp.text}"
    )


@pytest.mark.asyncio
async def test_admin_reset_empty_or_unset_env(
    monkeypatch: pytest.MonkeyPatch, client: AsyncClient
) -> None:
    """If ADMIN_SECRET env var is unset or empty, /admin/reset must always return 403."""
    monkeypatch.setenv("ADMIN_SECRET", "")
    import server.app.main as main_mod

    # Also test when main module ADMIN_SECRET is empty string
    orig_secret = main_mod.ADMIN_SECRET
    try:
        main_mod.ADMIN_SECRET = ""
        # Sending empty header
        resp1 = await client.post("/admin/reset", headers={"X-Admin": ""})
        assert resp1.status_code == 403, (
            f"Expected 403 when ADMIN_SECRET is empty, got {resp1.status_code}"
        )

        # Sending some string
        resp2 = await client.post("/admin/reset", headers={"X-Admin": "something"})
        assert resp2.status_code == 403, (
            f"Expected 403 when ADMIN_SECRET is empty, got {resp2.status_code}"
        )
    finally:
        main_mod.ADMIN_SECRET = orig_secret

"""Unit tests for Till0 server health endpoint."""

import pytest
from httpx import ASGITransport, AsyncClient

from server.app.main import app


@pytest.mark.asyncio
async def test_health_endpoint() -> None:
    """Verifies that GET /health returns 200 OK with status ok."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "ok"
        assert payload["version"] == "0.1.0"

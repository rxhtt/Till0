"""Pydantic request and response models for Till0 API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    """Response model for system health check."""

    model_config = ConfigDict(strict=True)

    status: str = Field(default="ok", description="Operational health status")
    version: str = Field(default="0.1.0", description="API server version")


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


class ProductOut(BaseModel):
    """Single product row returned from /catalog."""

    model_config = ConfigDict(strict=True)

    sku: str
    name: str
    price_paise: int
    tax_bp: int
    barcode: str
    opening_stock: int
    qty: int = Field(description="Current stock balance")


# ---------------------------------------------------------------------------
# Sync Push
# ---------------------------------------------------------------------------


class SaleLine(BaseModel):
    """One line in a SALE_COMPLETED event payload."""

    model_config = ConfigDict(strict=True)

    sku: str
    qty: int = Field(gt=0)
    price_paise: int = Field(ge=0)


class SalePayload(BaseModel):
    """Payload for SALE_COMPLETED events."""

    model_config = ConfigDict(strict=True)

    lines: list[SaleLine]
    tender: str
    total_paise: int = Field(ge=0)
    receipt_no: str


class StockReceivedLine(BaseModel):
    """One line in a STOCK_RECEIVED event payload."""

    model_config = ConfigDict(strict=True)

    sku: str
    qty: int = Field(gt=0)


class StockReceivedPayload(BaseModel):
    """Payload for STOCK_RECEIVED events."""

    model_config = ConfigDict(strict=True)

    lines: list[StockReceivedLine]


class PushEvent(BaseModel):
    """One event submitted in a /sync/push batch."""

    model_config = ConfigDict(strict=True)

    event_id: str
    terminal_id: str
    terminal_seq: int = Field(ge=0)
    type: Literal["SALE_COMPLETED", "STOCK_RECEIVED"]
    payload: dict[str, Any]
    client_ts: str = Field(description="ISO-8601 timestamp from the terminal")


class PushBatch(BaseModel):
    """Batch of up to 50 events sent to /sync/push."""

    model_config = ConfigDict(strict=True)

    events: list[PushEvent] = Field(max_length=50)


class PushEventResult(BaseModel):
    """Per-event result returned from /sync/push."""

    model_config = ConfigDict(strict=True)

    event_id: str
    status: Literal["applied", "duplicate", "rejected"]
    server_seq: int | None = None


class PushResponse(BaseModel):
    """Full response from /sync/push."""

    model_config = ConfigDict(strict=True)

    results: list[PushEventResult]


# ---------------------------------------------------------------------------
# Sync Pull
# ---------------------------------------------------------------------------


class StockSnapshot(BaseModel):
    """Current stock balance for one SKU."""

    model_config = ConfigDict(strict=True)

    sku: str
    qty: int


class StoredEvent(BaseModel):
    """One event as stored in the events table (returned in pull)."""

    model_config = ConfigDict(strict=True)

    server_seq: int
    event_id: str
    terminal_id: str
    terminal_seq: int
    type: str
    payload: dict[str, Any]
    client_ts: str
    received_at: str


class PullResponse(BaseModel):
    """Response for GET /sync/pull."""

    model_config = ConfigDict(strict=True)

    events: list[StoredEvent]
    balances: list[StockSnapshot]
    as_of_server_seq: int
    own_applied_ids: list[str]


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


class AuditSkuRow(BaseModel):
    """Audit result for one SKU."""

    model_config = ConfigDict(strict=True)

    sku: str
    opening: int
    sold: int
    received: int
    computed_balance: int
    stored_balance: int
    ok: bool


class AuditResponse(BaseModel):
    """Response for GET /audit."""

    model_config = ConfigDict(strict=True)

    status: Literal["PASS", "FAIL"]
    duplicate_event_ids: list[str]
    seq_gaps: list[int]
    skus: list[AuditSkuRow]


# ---------------------------------------------------------------------------
# Ledger
# ---------------------------------------------------------------------------


class AlertOut(BaseModel):
    """One undelivered alert."""

    model_config = ConfigDict(strict=True)

    id: int
    sku: str
    qty: int
    created_at: str


class ExceptionOut(BaseModel):
    """One stock exception (balance went below zero)."""

    model_config = ConfigDict(strict=True)

    id: int
    sku: str
    event_id: str
    qty_after: int
    created_at: str


class DeadLetterOut(BaseModel):
    """One dead-letter event."""

    model_config = ConfigDict(strict=True)

    event_id: str
    reason: str


class LedgerResponse(BaseModel):
    """Response for GET /ledger (Stage panel compact state)."""

    model_config = ConfigDict(strict=True)

    event_count: int
    duplicates_rejected: int
    balances: list[StockSnapshot]
    exceptions: list[ExceptionOut]
    dead_letters: list[DeadLetterOut]
    alerts: list[AlertOut]

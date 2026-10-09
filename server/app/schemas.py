"""Pydantic request and response models for Till0 API."""

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    """Response model for system health check."""

    model_config = ConfigDict(strict=True)

    status: str = Field(default="ok", description="Operational health status")
    version: str = Field(default="0.1.0", description="API server version")

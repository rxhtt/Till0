"""FastAPI application entry point for Till0."""

from fastapi import FastAPI

from server.app.schemas import HealthResponse

app = FastAPI(
    title="Till0 POS Server",
    version="0.1.0",
    description="Backend API and sync ledger for Till0 POS.",
)


@app.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Check API server health status.

    Returns:
        HealthResponse model indicating server status.
    """
    return HealthResponse(status="ok", version="0.1.0")

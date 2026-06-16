from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.middleware.rate_limit import InMemoryRateLimitMiddleware
from app.routers.agents import router as agents_router
from app.routers.health import router as health_router
from app.routers.rag import router as rag_router
from app.settings import CORS_ORIGINS

app = FastAPI(
    title="Tripy AI Backend",
    description="Agent + RAG + MCP orchestration service for travel recommendations.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.add_middleware(InMemoryRateLimitMiddleware)

app.include_router(health_router)
app.include_router(agents_router)
app.include_router(rag_router)

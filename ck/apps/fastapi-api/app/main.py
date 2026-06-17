from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers.agent import router as agent_router
from app.routers.demo import router as demo_router
from app.routers.mcp import router as mcp_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(demo_router)
app.include_router(mcp_router)
app.include_router(agent_router)

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.routers.demo import router as demo_router
from app.routers.pet_behavior import router as pet_behavior_router

app = FastAPI()


@app.get("/health")
def health():
    return {"service": "tail-talk-ai-worker", "status": "ok"}

app.include_router(demo_router)
app.include_router(pet_behavior_router)

from fastapi import FastAPI
from app.routers.demo import router as demo_router

app = FastAPI()

app.include_router(demo_router)